"""Pure pairing helpers: python3 -m unittest discover -s tools -p 'test_eval_pair.py'."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("eval_pair", Path(__file__).with_name("eval-pair.py"))
eval_pair = importlib.util.module_from_spec(spec)
spec.loader.exec_module(eval_pair)


class PairHelpersTest(unittest.TestCase):
    def test_base_scenario(self):
        for sid, expected in [("callback@1", "callback"), ("callback@12", "callback"),
                              ("callback", "callback"), ("callback@x", "callback@x")]:
            self.assertEqual(eval_pair.base_scenario(sid), expected)

    def test_exact_sign_test(self):
        for wins, losses, expected in [(0, 0, 1), (4, 4, 1), (1, 0, 1), (5, 0, .0625),
                                      (0, 5, .0625), (8, 2, .109375), (1000, 1000, 1)]:
            self.assertAlmostEqual(eval_pair.sign_test(wins, losses), expected)
