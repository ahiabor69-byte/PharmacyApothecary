import unittest

from calculations import net_profit, sale_totals


class SaleTotalsTests(unittest.TestCase):
    def test_calculates_revenue_cost_and_profit(self):
        self.assertEqual(sale_totals(3, 12.50, 7.00, 2.50), (35.00, 21.00, 14.00))

    def test_accepts_discount_equal_to_revenue(self):
        self.assertEqual(sale_totals(2, 5.00, 3.00, 10.00), (0.00, 6.00, -6.00))

    def test_supports_fractional_prices(self):
        revenue, cost, profit = sale_totals(7, 1.35, 0.80, 0.25)
        self.assertAlmostEqual(revenue, 9.20)
        self.assertAlmostEqual(cost, 5.60)
        self.assertAlmostEqual(profit, 3.60)


class NetProfitTests(unittest.TestCase):
    def test_subtracts_cost_and_expenses(self):
        self.assertEqual(net_profit(100.00, 60.00, 15.00), 25.00)

    def test_supports_a_loss(self):
        self.assertEqual(net_profit(40.00, 50.00, 5.00), -15.00)


if __name__ == "__main__":
    unittest.main()
