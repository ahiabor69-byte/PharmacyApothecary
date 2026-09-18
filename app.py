import sqlite3
import sys
from pathlib import Path

from PySide6.QtCore import QDate, Qt
from PySide6.QtWidgets import (
    QApplication, QComboBox, QDateEdit, QDoubleSpinBox, QFormLayout,
    QGridLayout, QGroupBox, QHBoxLayout, QHeaderView, QLabel, QLineEdit,
    QMainWindow, QMessageBox, QPushButton, QSpinBox, QTableWidget,
    QTableWidgetItem, QTabWidget, QVBoxLayout, QWidget,
)

from calculations import net_profit, sale_totals

DB = Path(__file__).with_name("pharmacy.db")
DATE_FORMAT = "yyyy-MM-dd"


class PharmacyWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Pharmacy Retail Manager")
        self.resize(1280, 800)
        self.db = sqlite3.connect(DB)
        self.db.row_factory = sqlite3.Row
        self.create_schema()
        self.build_ui()
        self.refresh_all()

    def create_schema(self):
        self.db.executescript("""
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY, sku TEXT UNIQUE NOT NULL, barcode TEXT DEFAULT '',
            name TEXT NOT NULL, dosage_form TEXT DEFAULT '', strength TEXT DEFAULT '',
            category TEXT DEFAULT '', supplier TEXT DEFAULT '', stock INTEGER DEFAULT 0,
            reorder_level INTEGER DEFAULT 5, purchase_price REAL DEFAULT 0,
            selling_price REAL DEFAULT 0, expiry_date TEXT DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS sales (
            id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL, quantity INTEGER NOT NULL,
            selling_price REAL NOT NULL, purchase_price REAL NOT NULL, discount REAL DEFAULT 0,
            payment_method TEXT DEFAULT 'Cash', customer_name TEXT DEFAULT '',
            sold_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS batches (
            id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL, batch_number TEXT NOT NULL,
            quantity_received INTEGER NOT NULL, quantity_remaining INTEGER NOT NULL,
            purchase_price REAL NOT NULL, expiry_date TEXT NOT NULL,
            received_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS stock_movements (
            id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL, movement_type TEXT NOT NULL,
            quantity INTEGER NOT NULL, reference TEXT DEFAULT '', notes TEXT DEFAULT '',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS expenses (
            id INTEGER PRIMARY KEY, category TEXT NOT NULL, description TEXT NOT NULL,
            amount REAL NOT NULL, expense_date TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        """)
        self.add_column("products", "barcode", "TEXT DEFAULT ''")
        self.add_column("products", "dosage_form", "TEXT DEFAULT ''")
        self.add_column("products", "strength", "TEXT DEFAULT ''")
        self.add_column("sales", "discount", "REAL DEFAULT 0")
        self.add_column("sales", "payment_method", "TEXT DEFAULT 'Cash'")
        self.add_column("sales", "customer_name", "TEXT DEFAULT ''")
        self.db.commit()

    def add_column(self, table, column, definition):
        columns = {row[1] for row in self.db.execute(f"PRAGMA table_info({table})")}
        if column not in columns:
            self.db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")

    def build_ui(self):
        self.tabs = QTabWidget()
        self.tabs.setDocumentMode(True)
        self.tabs.setMovable(False)
        self.tabs.tabBar().setExpanding(False)
        self.tabs.addTab(self.dashboard_page(), "Dashboard")
        self.tabs.addTab(self.inventory_page(), "Products & batches")
        self.tabs.addTab(self.sales_page(), "Sales")
        self.tabs.addTab(self.movements_page(), "Stock history")
        self.tabs.addTab(self.expenses_page(), "Expenses")
        self.tabs.addTab(self.report_page(), "Reports")
        header = QWidget()
        header_layout = QHBoxLayout(header)
        header_layout.setContentsMargins(24, 18, 24, 14)
        brand = QLabel("APOTHECA")
        brand.setObjectName("brandName")
        subtitle = QLabel("Retail pharmacy operations")
        subtitle.setObjectName("brandSubtitle")
        header_layout.addWidget(brand)
        header_layout.addWidget(subtitle)
        header_layout.addStretch()
        shell = QWidget()
        shell_layout = QVBoxLayout(shell)
        shell_layout.setContentsMargins(0, 0, 0, 0)
        shell_layout.setSpacing(0)
        shell_layout.addWidget(header)
        shell_layout.addWidget(self.tabs)
        self.setCentralWidget(shell)
        self.statusBar().showMessage(f"Connected to {DB.name}")

    def title(self, text):
        label = QLabel(text); label.setObjectName("pageTitle"); return label

    def money(self):
        widget = QDoubleSpinBox(); widget.setRange(0, 10000000); widget.setDecimals(2); widget.setPrefix("GH₵ "); return widget

    def number(self, value=0):
        widget = QSpinBox(); widget.setRange(0, 1000000); widget.setValue(value); return widget

    def table(self, headers):
        widget = QTableWidget(0, len(headers)); widget.setHorizontalHeaderLabels(headers)
        widget.setObjectName("dataTable")
        widget.setAlternatingRowColors(True); widget.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        widget.setShowGrid(False); widget.setWordWrap(False); widget.verticalHeader().setDefaultSectionSize(34)
        widget.verticalHeader().setVisible(False)
        widget.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.ResizeToContents)
        widget.horizontalHeader().setStretchLastSection(True); return widget

    def metric_card(self, grid, row, column, title):
        box = QGroupBox(title); layout = QVBoxLayout(box); value = QLabel("GH₵ 0.00")
        value.setObjectName("metricValue"); layout.addWidget(value); grid.addWidget(box, row, column); return value

    def dashboard_page(self):
        page = QWidget(); layout = QVBoxLayout(page); layout.addWidget(self.title("Retail pharmacy dashboard")); cards = QGridLayout()
        self.stock_value = self.metric_card(cards, 0, 0, "Inventory cost value"); self.revenue = self.metric_card(cards, 0, 1, "Gross sales"); self.gross_profit = self.metric_card(cards, 0, 2, "Gross profit"); self.net_profit = self.metric_card(cards, 0, 3, "Net profit")
        self.low_stock = self.metric_card(cards, 1, 0, "Low-stock products"); self.expiring = self.metric_card(cards, 1, 1, "Expiring in 30 days"); self.expense_total = self.metric_card(cards, 1, 2, "Operating expenses"); self.units_sold = self.metric_card(cards, 1, 3, "Units sold")
        layout.addLayout(cards); layout.addWidget(QLabel("Items needing attention")); self.warning_table = self.table(["SKU", "Medicine", "Stock", "Reorder", "Expiry", "Batch"]); layout.addWidget(self.warning_table); return page

    def inventory_page(self):
        page = QWidget(); layout = QVBoxLayout(page); layout.addWidget(self.title("Products and batch receiving")); box = QGroupBox("Product and received batch"); form = QFormLayout(box)
        self.sku = QLineEdit(); self.barcode = QLineEdit(); self.name = QLineEdit(); self.name.setPlaceholderText("Paracetamol 500mg"); self.form_name = QLineEdit(); self.form_name.setPlaceholderText("Tablet, syrup, cream"); self.strength = QLineEdit(); self.category = QLineEdit(); self.supplier = QLineEdit(); self.batch = QLineEdit(); self.batch.setPlaceholderText("Lot number"); self.received = self.number(); self.reorder = self.number(5); self.buy = self.money(); self.sell = self.money(); self.expiry = QDateEdit(QDate.currentDate()); self.expiry.setCalendarPopup(True); self.expiry.setDisplayFormat(DATE_FORMAT)
        for label, field in (("SKU", self.sku), ("Barcode", self.barcode), ("Medicine name", self.name), ("Dosage form", self.form_name), ("Strength", self.strength), ("Category", self.category), ("Supplier", self.supplier), ("Batch number", self.batch), ("Quantity received", self.received), ("Reorder level", self.reorder), ("Purchase price", self.buy), ("Selling price", self.sell), ("Expiry date", self.expiry)): form.addRow(label, field)
        button = QPushButton("Receive stock"); button.clicked.connect(self.receive_stock); form.addRow(button); layout.addWidget(box); search = QHBoxLayout(); search.addWidget(QLabel("Search")); self.search = QLineEdit(); self.search.setPlaceholderText("SKU, barcode, product, category, supplier, or batch"); self.search.textChanged.connect(self.refresh_inventory); search.addWidget(self.search); layout.addLayout(search); self.inventory_table = self.table(["SKU", "Barcode", "Medicine", "Form", "Strength", "Category", "Supplier", "Stock", "Buy", "Sell", "Margin", "Expiry", "Batch"]); layout.addWidget(self.inventory_table); return page

    def sales_page(self):
        page = QWidget(); layout = QVBoxLayout(page); layout.addWidget(self.title("Point of sale and sales history")); box = QGroupBox("Complete a sale"); form = QFormLayout(box); self.sale_product = QComboBox(); self.sale_qty = self.number(1); self.sale_price = self.money(); self.discount = self.money(); self.payment = QComboBox(); self.payment.addItems(["Cash", "Card", "Mobile money", "Insurance", "Credit"]); self.customer = QLineEdit()
        for label, field in (("Product", self.sale_product), ("Quantity", self.sale_qty), ("Price per item", self.sale_price), ("Discount", self.discount), ("Payment method", self.payment), ("Customer", self.customer)): form.addRow(label, field)
        button = QPushButton("Complete sale"); button.clicked.connect(self.record_sale); form.addRow(button); layout.addWidget(box); layout.addWidget(QLabel("Sales history")); self.sales_table = self.table(["Date", "Medicine", "Qty", "Revenue", "Discount", "Cost", "Profit", "Payment", "Customer"]); layout.addWidget(self.sales_table); return page

    def movements_page(self):
        page = QWidget(); layout = QVBoxLayout(page); layout.addWidget(self.title("Stock movement audit trail")); box = QGroupBox("Manual adjustment"); form = QFormLayout(box); self.adjust_product = QComboBox(); self.adjust_qty = self.number(1); self.adjust_type = QComboBox(); self.adjust_type.addItems(["Adjustment in", "Adjustment out", "Damaged", "Expired", "Returned"]); self.adjust_reference = QLineEdit(); self.adjust_notes = QLineEdit()
        for label, field in (("Product", self.adjust_product), ("Quantity", self.adjust_qty), ("Type", self.adjust_type), ("Reference", self.adjust_reference), ("Notes", self.adjust_notes)): form.addRow(label, field)
        button = QPushButton("Save adjustment"); button.clicked.connect(self.record_adjustment); form.addRow(button); layout.addWidget(box); self.movements_table = self.table(["Date", "Medicine", "Type", "Quantity", "Reference", "Notes"]); layout.addWidget(self.movements_table); return page

    def expenses_page(self):
        page = QWidget(); layout = QVBoxLayout(page); layout.addWidget(self.title("Operating expenses")); box = QGroupBox("Add expense"); form = QFormLayout(box); self.expense_category = QComboBox(); self.expense_category.addItems(["Rent", "Utilities", "Salaries", "Transport", "Supplies", "Taxes", "Other"]); self.expense_description = QLineEdit(); self.expense_amount = self.money(); self.expense_date = QDateEdit(QDate.currentDate()); self.expense_date.setCalendarPopup(True); self.expense_date.setDisplayFormat(DATE_FORMAT)
        for label, field in (("Category", self.expense_category), ("Description", self.expense_description), ("Amount", self.expense_amount), ("Date", self.expense_date)): form.addRow(label, field)
        button = QPushButton("Save expense"); button.clicked.connect(self.save_expense); form.addRow(button); layout.addWidget(box); self.expenses_table = self.table(["Date", "Category", "Description", "Amount"]); layout.addWidget(self.expenses_table); return page

    def report_page(self):
        page = QWidget(); layout = QVBoxLayout(page); layout.addWidget(self.title("Profit reports")); filters = QHBoxLayout(); self.date_from = QDateEdit(QDate.currentDate().addDays(-30)); self.date_to = QDateEdit(QDate.currentDate())
        for date in (self.date_from, self.date_to): date.setCalendarPopup(True); date.setDisplayFormat(DATE_FORMAT)
        filters.addWidget(QLabel("From")); filters.addWidget(self.date_from); filters.addWidget(QLabel("To")); filters.addWidget(self.date_to); refresh = QPushButton("Refresh report"); refresh.clicked.connect(self.refresh_report); filters.addWidget(refresh); layout.addLayout(filters); self.report_revenue = self.report_value(layout, "Revenue"); self.report_cost = self.report_value(layout, "Cost of goods"); self.report_profit = self.report_value(layout, "Gross profit"); self.report_expenses = self.report_value(layout, "Expenses"); self.report_net = self.report_value(layout, "Net profit"); self.report_table = self.table(["Medicine", "Units", "Revenue", "Cost", "Profit"]); layout.addWidget(self.report_table); return page

    def report_value(self, layout, title):
        row = QHBoxLayout(); row.addWidget(QLabel(title)); value = QLabel("GH₵ 0.00"); value.setObjectName("reportValue"); row.addWidget(value); row.addStretch(); layout.addLayout(row); return value

    def receive_stock(self):
        sku, name, batch = self.sku.text().strip(), self.name.text().strip(), self.batch.text().strip(); quantity = self.received.value()
        if not sku or not name or not batch or quantity < 1: QMessageBox.warning(self, "Missing information", "SKU, medicine name, batch number, and quantity are required."); return
        values = (sku, self.barcode.text().strip(), name, self.form_name.text().strip(), self.strength.text().strip(), self.category.text().strip(), self.supplier.text().strip(), quantity, self.reorder.value(), self.buy.value(), self.sell.value(), self.expiry.date().toString(DATE_FORMAT))
        self.db.execute("""INSERT INTO products (sku,barcode,name,dosage_form,strength,category,supplier,stock,reorder_level,purchase_price,selling_price,expiry_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(sku) DO UPDATE SET barcode=excluded.barcode,name=excluded.name,dosage_form=excluded.dosage_form,strength=excluded.strength,category=excluded.category,supplier=excluded.supplier,stock=products.stock+excluded.stock,reorder_level=excluded.reorder_level,purchase_price=excluded.purchase_price,selling_price=excluded.selling_price,expiry_date=excluded.expiry_date""", values)
        product_id = self.db.execute("SELECT id FROM products WHERE sku=?", (sku,)).fetchone()["id"]; expiry = self.expiry.date().toString(DATE_FORMAT)
        self.db.execute("INSERT INTO batches (product_id,batch_number,quantity_received,quantity_remaining,purchase_price,expiry_date) VALUES (?,?,?,?,?,?)", (product_id, batch, quantity, quantity, self.buy.value(), expiry)); self.db.execute("INSERT INTO stock_movements (product_id,movement_type,quantity,reference,notes) VALUES (?,'Received',?,?,?)", (product_id, quantity, batch, f"Supplier: {self.supplier.text().strip()}")); self.db.commit(); self.refresh_all(); self.statusBar().showMessage(f"Received {quantity} units of {name}", 4000)

    def record_sale(self):
        product_id = self.sale_product.currentData(); quantity = self.sale_qty.value()
        if product_id is None: QMessageBox.warning(self, "No product", "Receive a product before recording a sale."); return
        product = self.db.execute("SELECT * FROM products WHERE id=?", (product_id,)).fetchone(); discount = self.discount.value(); revenue, _, _ = sale_totals(quantity, self.sale_price.value(), product["purchase_price"], discount)
        if product["stock"] < quantity or revenue < 0: QMessageBox.warning(self, "Invalid sale", "Check available stock and discount amount."); return
        self.db.execute("UPDATE products SET stock=stock-? WHERE id=?", (quantity, product_id)); self.db.execute("INSERT INTO sales (product_id,quantity,selling_price,purchase_price,discount,payment_method,customer_name) VALUES (?,?,?,?,?,?,?)", (product_id, quantity, self.sale_price.value(), product["purchase_price"], discount, self.payment.currentText(), self.customer.text().strip())); self.db.execute("INSERT INTO stock_movements (product_id,movement_type,quantity,reference,notes) VALUES (?,'Sold',?,'Sale',?)", (product_id, -quantity, self.payment.currentText())); self.db.commit(); self.refresh_all(); self.statusBar().showMessage(f"Sale completed: GH₵ {revenue:.2f}", 4000)

    def record_adjustment(self):
        product_id = self.adjust_product.currentData(); quantity = self.adjust_qty.value(); kind = self.adjust_type.currentText(); delta = quantity if kind in ("Adjustment in", "Returned") else -quantity
        product = self.db.execute("SELECT name,stock FROM products WHERE id=?", (product_id,)).fetchone()
        if product is None or product["stock"] + delta < 0: QMessageBox.warning(self, "Invalid adjustment", "Stock cannot become negative."); return
        self.db.execute("UPDATE products SET stock=stock+? WHERE id=?", (delta, product_id)); self.db.execute("INSERT INTO stock_movements (product_id,movement_type,quantity,reference,notes) VALUES (?,?,?,?,?)", (product_id, kind, delta, self.adjust_reference.text().strip(), self.adjust_notes.text().strip())); self.db.commit(); self.refresh_all()

    def save_expense(self):
        if not self.expense_description.text().strip() or self.expense_amount.value() <= 0: QMessageBox.warning(self, "Missing information", "Description and amount are required."); return
        self.db.execute("INSERT INTO expenses (category,description,amount,expense_date) VALUES (?,?,?,?)", (self.expense_category.currentText(), self.expense_description.text().strip(), self.expense_amount.value(), self.expense_date.date().toString(DATE_FORMAT))); self.db.commit(); self.refresh_all()

    def refresh_all(self): self.refresh_products(); self.refresh_inventory(); self.refresh_sales(); self.refresh_movements(); self.refresh_expenses(); self.refresh_dashboard(); self.refresh_report()

    def refresh_products(self):
        rows = self.db.execute("SELECT id,sku,name,stock FROM products ORDER BY name").fetchall()
        for combo in (self.sale_product, self.adjust_product):
            current = combo.currentData(); combo.blockSignals(True); combo.clear()
            for row in rows: combo.addItem(f"{row['name']} ({row['sku']}) - {row['stock']} units", row["id"])
            if current is not None and combo.findData(current) >= 0: combo.setCurrentIndex(combo.findData(current))
            combo.blockSignals(False)
        if self.sale_product.currentData() is not None: self.sale_price.setValue(self.db.execute("SELECT selling_price FROM products WHERE id=?", (self.sale_product.currentData(),)).fetchone()[0])

    def refresh_inventory(self):
        pattern = f"%{self.search.text().strip()}%"; rows = self.db.execute("SELECT p.*,p.selling_price-p.purchase_price margin,COALESCE((SELECT batch_number FROM batches b WHERE b.product_id=p.id ORDER BY b.expiry_date LIMIT 1),'') batch FROM products p WHERE p.sku LIKE ? OR p.barcode LIKE ? OR p.name LIKE ? OR p.category LIKE ? OR p.supplier LIKE ? ORDER BY p.name", (pattern,)*5).fetchall(); self.inventory_table.setRowCount(0)
        for row in rows: self.add_row(self.inventory_table, [row["sku"],row["barcode"],row["name"],row["dosage_form"],row["strength"],row["category"],row["supplier"],row["stock"],f"GH₵ {row['purchase_price']:.2f}",f"GH₵ {row['selling_price']:.2f}",f"GH₵ {row['margin']:.2f}",row["expiry_date"],row["batch"]], row["stock"] <= row["reorder_level"])

    def refresh_sales(self):
        rows = self.db.execute("SELECT s.*,p.name FROM sales s JOIN products p ON p.id=s.product_id ORDER BY s.id DESC").fetchall(); self.sales_table.setRowCount(0)
        for row in rows:
            revenue, cost, profit = sale_totals(row["quantity"], row["selling_price"], row["purchase_price"], row["discount"])
            self.add_row(self.sales_table, [row["sold_at"],row["name"],row["quantity"],f"GH₵ {revenue:.2f}",f"GH₵ {row['discount']:.2f}",f"GH₵ {cost:.2f}",f"GH₵ {profit:.2f}",row["payment_method"],row["customer_name"]])

    def refresh_movements(self):
        rows = self.db.execute("SELECT m.*,p.name FROM stock_movements m JOIN products p ON p.id=m.product_id ORDER BY m.id DESC").fetchall(); self.movements_table.setRowCount(0)
        for row in rows: self.add_row(self.movements_table, [row["created_at"],row["name"],row["movement_type"],row["quantity"],row["reference"],row["notes"]])

    def refresh_expenses(self):
        rows = self.db.execute("SELECT * FROM expenses ORDER BY expense_date DESC,id DESC").fetchall(); self.expenses_table.setRowCount(0)
        for row in rows: self.add_row(self.expenses_table, [row["expense_date"],row["category"],row["description"],f"GH₵ {row['amount']:.2f}"])

    def refresh_dashboard(self):
        stock = self.db.execute("SELECT COALESCE(SUM(stock*purchase_price),0) value FROM products").fetchone()["value"]; totals = self.db.execute("SELECT COALESCE(SUM(quantity*selling_price-discount),0) revenue,COALESCE(SUM(quantity*purchase_price),0) cost,COALESCE(SUM(quantity),0) units FROM sales").fetchone(); expenses = self.db.execute("SELECT COALESCE(SUM(amount),0) value FROM expenses").fetchone()["value"]; low = self.db.execute("SELECT COUNT(*) n FROM products WHERE stock<=reorder_level").fetchone()["n"]; expiring = self.db.execute("SELECT COUNT(*) n FROM products WHERE expiry_date<=date('now','+30 day')").fetchone()["n"]
        self.stock_value.setText(f"GH₵ {stock:,.2f}"); self.revenue.setText(f"GH₵ {totals['revenue']:,.2f}"); self.gross_profit.setText(f"GH₵ {totals['revenue']-totals['cost']:,.2f}"); self.net_profit.setText(f"GH₵ {totals['revenue']-totals['cost']-expenses:,.2f}"); self.low_stock.setText(str(low)); self.expiring.setText(str(expiring)); self.expense_total.setText(f"GH₵ {expenses:,.2f}"); self.units_sold.setText(str(totals["units"]))
        rows = self.db.execute("SELECT p.sku,p.name,p.stock,p.reorder_level,p.expiry_date,COALESCE((SELECT batch_number FROM batches b WHERE b.product_id=p.id ORDER BY b.expiry_date LIMIT 1),'') batch FROM products p WHERE p.stock<=p.reorder_level OR p.expiry_date<=date('now','+30 day') ORDER BY p.stock,p.expiry_date").fetchall(); self.warning_table.setRowCount(0)
        for row in rows: self.add_row(self.warning_table, [row["sku"],row["name"],row["stock"],row["reorder_level"],row["expiry_date"],row["batch"]])

    def refresh_report(self):
        start = self.date_from.date().toString(DATE_FORMAT); end = self.date_to.date().toString(DATE_FORMAT); totals = self.db.execute("SELECT COALESCE(SUM(quantity*selling_price-discount),0) revenue,COALESCE(SUM(quantity*purchase_price),0) cost FROM sales WHERE date(sold_at) BETWEEN ? AND ?", (start,end)).fetchone(); expense = self.db.execute("SELECT COALESCE(SUM(amount),0) value FROM expenses WHERE expense_date BETWEEN ? AND ?", (start,end)).fetchone()["value"]; revenue, cost = totals["revenue"], totals["cost"]
        self.report_revenue.setText(f"GH₵ {revenue:,.2f}"); self.report_cost.setText(f"GH₵ {cost:,.2f}"); self.report_profit.setText(f"GH₵ {revenue-cost:,.2f}"); self.report_expenses.setText(f"GH₵ {expense:,.2f}"); self.report_net.setText(f"GH₵ {revenue-cost-expense:,.2f}"); rows = self.db.execute("SELECT p.name,SUM(s.quantity) units,SUM(s.quantity*s.selling_price-s.discount) revenue,SUM(s.quantity*s.purchase_price) cost FROM sales s JOIN products p ON p.id=s.product_id WHERE date(s.sold_at) BETWEEN ? AND ? GROUP BY p.id ORDER BY revenue DESC", (start,end)).fetchall(); self.report_table.setRowCount(0)
        for row in rows: self.add_row(self.report_table, [row["name"],row["units"],f"GH₵ {row['revenue']:.2f}",f"GH₵ {row['cost']:.2f}",f"GH₵ {row['revenue']-row['cost']:.2f}"])

    def add_row(self, table, values, highlight=False):
        row = table.rowCount(); table.insertRow(row)
        for column, value in enumerate(values):
            item = QTableWidgetItem(str(value)); table.setItem(row, column, item)
            if highlight: item.setBackground(Qt.GlobalColor.yellow)

    def closeEvent(self, event): self.db.close(); event.accept()


application = QApplication(sys.argv)
application.setStyle("Fusion")
application.setStyleSheet("""
    QWidget { font-size: 14px; color: #18181b; }
    QMainWindow { background: #fafafa; }
    #brandName { color: #115e59; font-size: 22px; font-weight: 800; letter-spacing: 2px; }
    #brandSubtitle { color: #71717a; font-size: 13px; padding-left: 10px; }
    #pageTitle { color: #18181b; font-size: 25px; font-weight: 700; padding: 8px 0 12px; }
    #metricValue, #reportValue { color: #0f766e; font-size: 21px; font-weight: 700; }
    QTabWidget::pane { border: 0; background: #fafafa; }
    QTabBar { background: #fafafa; }
    QTabBar::tab { color: #71717a; padding: 12px 18px; margin-right: 3px; border-bottom: 2px solid transparent; }
    QTabBar::tab:hover { color: #27272a; }
    QTabBar::tab:selected { color: #115e59; font-weight: 700; border-bottom-color: #0f766e; }
    QGroupBox { background: #ffffff; border: 1px solid #e4e4e7; border-radius: 6px; margin-top: 12px; padding: 18px 14px 12px; font-weight: 700; }
    QGroupBox::title { subcontrol-origin: margin; left: 12px; padding: 0 6px; color: #3f3f46; background: #fafafa; }
    QLineEdit, QSpinBox, QDoubleSpinBox, QComboBox, QDateEdit { background: #ffffff; border: 1px solid #d4d4d8; border-radius: 6px; padding: 7px 9px; min-height: 18px; selection-background-color: #99f6e4; }
    QLineEdit:hover, QSpinBox:hover, QDoubleSpinBox:hover, QComboBox:hover, QDateEdit:hover { border-color: #a1a1aa; }
    QLineEdit:focus, QSpinBox:focus, QDoubleSpinBox:focus, QComboBox:focus, QDateEdit:focus { border: 2px solid #0f766e; padding: 6px 8px; }
    QLineEdit:disabled, QSpinBox:disabled, QDoubleSpinBox:disabled, QComboBox:disabled, QDateEdit:disabled { background: #f4f4f5; color: #a1a1aa; }
    QComboBox::drop-down { width: 28px; border: 0; }
    QComboBox QAbstractItemView { background: #ffffff; border: 1px solid #d4d4d8; selection-background-color: #ccfbf1; selection-color: #134e4a; padding: 4px; }
    QPushButton { background: #115e59; color: #ffffff; border: 1px solid #115e59; border-radius: 6px; padding: 9px 18px; font-weight: 700; }
    QPushButton:hover { background: #0f766e; border-color: #0f766e; }
    QPushButton:pressed { background: #134e4a; }
    QPushButton:disabled { background: #e4e4e7; color: #a1a1aa; border-color: #e4e4e7; }
    QTableWidget#dataTable { background: #ffffff; border: 1px solid #e4e4e7; border-radius: 6px; alternate-background-color: #f4f4f5; selection-background-color: #ccfbf1; selection-color: #134e4a; }
    QTableWidget#dataTable::item { padding: 4px; border-bottom: 1px solid #f4f4f5; }
    QTableWidget#dataTable::item:hover { background: #f0fdfa; }
    QHeaderView::section { background: #f4f4f5; color: #52525b; border: 0; border-bottom: 1px solid #d4d4d8; padding: 9px 8px; font-weight: 700; }
    QTableCornerButton::section { background: #f4f4f5; border: 0; border-bottom: 1px solid #d4d4d8; }
    QScrollBar:vertical { background: #fafafa; width: 10px; margin: 0; }
    QScrollBar::handle:vertical { background: #d4d4d8; border-radius: 5px; min-height: 24px; }
    QScrollBar::handle:vertical:hover { background: #a1a1aa; }
    QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical { height: 0; }
    QScrollBar:horizontal { background: #fafafa; height: 10px; margin: 0; }
    QScrollBar::handle:horizontal { background: #d4d4d8; border-radius: 5px; min-width: 24px; }
    QScrollBar::handle:horizontal:hover { background: #a1a1aa; }
    QScrollBar::add-line:horizontal, QScrollBar::sub-line:horizontal { width: 0; }
    QToolTip { background: #18181b; color: #fafafa; border: 0; padding: 6px 8px; }
    QStatusBar { background: #f4f4f5; color: #52525b; border-top: 1px solid #e4e4e7; }
""")
window = PharmacyWindow()
window.show()
sys.exit(application.exec())