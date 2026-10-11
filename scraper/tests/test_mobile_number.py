"""U Mobile number generator (ClickUp z8v9xnhhkh)."""
import re

from oe_feasibility import is_mobile_tab, new_mobile_number


def test_generator_shape_and_no_repeats_within_an_order():
    tried: set = set()
    for _ in range(60):
        n = new_mobile_number(tried)
        assert re.fullmatch(r"011\d{8}", n), n
        assert n not in tried
        tried.add(n)


def test_mobile_tab_is_only_the_mobile_tab():
    assert is_mobile_tab("Unifi Mobile UNI5G 39 (Mobile)")
    assert is_mobile_tab("UNI5G39")
    for t in ("Unifi Home 300Mbps (Broadband)", "Home Voice (Voice)",
              "Unifi Home Plus with UNI5G39 (Bundle)", "Value TV Pack (TV)"):
        assert not is_mobile_tab(t), t
