def sale_totals(quantity, selling_price, purchase_price, discount):
    revenue = quantity * selling_price - discount
    cost = quantity * purchase_price
    return revenue, cost, revenue - cost


def net_profit(revenue, cost, expenses):
    return revenue - cost - expenses
