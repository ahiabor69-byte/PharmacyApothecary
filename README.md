# Pharmacy Inventory

## New desktop foundation

The migration to Electron, React, Node.js, and SQLite is underway. Run the new
desktop shell with:

```bash
npm install
npm run dev
```

See `README-ELECTRON.md` for the migration architecture and current scope. The
original PySide6 application remains available through `app.py` while the
features are moved across incrementally.

A detailed retail pharmacy system built with Python, PySide6, and SQLite.

## Run

```bash
source .venv/bin/activate
QT_PLUGIN_PATH="$PWD/.venv/lib/python3.14/site-packages/PySide6/Qt/plugins" python app.py
```

## Launch from the desktop

The Electron version can be opened by double-clicking `PharmacyApothecary.desktop`.
To add it to the desktop applications menu, run:

```bash
./install-desktop-launcher.sh
```

After installation, search for **Pharmacy Apothecary** in the applications menu
and click it to launch the app.

The app creates `pharmacy.db` next to `app.py`. Back up this file to preserve the
inventory and sales history.

## Features

- Product details: SKU, barcode, medicine name, dosage form, strength, category,
  supplier, reorder level, prices, and expiry date.
- Batch receiving with batch number, quantity, purchase price, and expiry date.
- Stock movement audit trail for receiving, sales, adjustments, damaged stock,
  expired stock, and returns.
- Point of sale records with discounts, customer names, and payment methods.
- Operating expense tracking for rent, utilities, salaries, transport, supplies,
  taxes, and other costs.
- Dashboard totals for inventory value, revenue, gross profit, net profit,
  expenses, units sold, low stock, and expiry warnings.
- Date-filtered reports showing revenue, cost of goods, gross profit, expenses,
  net profit, and profit by medicine.
- Existing `pharmacy.db` data is preserved when the app starts.

## What to study

- `QMainWindow` creates the application window.
- SQLite persists all products, batches, sales, movements, and expenses after the app closes.
- Widgets such as `QLineEdit`, `QSpinBox`, `QComboBox`, and `QTableWidget` build the interface.
- Layouts arrange widgets without fixed coordinates.
- Signals such as `clicked.connect(self.record_sale)` connect user actions to Python code.
- Gross profit is `sales revenue - cost of goods`.
- Net profit is `gross profit - operating expenses`.



# to launch or run the program
cd '/home/drew/Documents/Pharmacy\'
source .venv/bin/activate
QT_PLUGIN_PATH="$PWD/.venv/lib/python3.14/site-packages/PySide6/Qt/plugins" python app.py
