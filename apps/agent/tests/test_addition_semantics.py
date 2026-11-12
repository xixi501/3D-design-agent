from actiscape_agent.addition_semantics import semantic_errors

CATALOGUE = {
    "sofa": {"key": "sofa", "name": "三人沙发", "type": "sofa", "w": 2200, "d": 950},
    "armchair": {"key": "armchair", "name": "单人沙发", "type": "armchair", "w": 850, "d": 850},
    "bed18": {"key": "bed18", "name": "双人床 1.8m", "type": "bed", "w": 1800, "d": 2100},
    "bed15": {"key": "bed15", "name": "双人床 1.5m", "type": "bed", "w": 1500, "d": 2050},
    "counter": {
        "key": "counter",
        "name": "一字橱柜（可定制）",
        "type": "counter",
        "w": 2100,
        "d": 600,
    },
    "lCounter": {
        "key": "lCounter",
        "name": "L 形橱柜（可定制）",
        "type": "lCounter",
        "w": 2400,
        "d": 1800,
    },
    "chair": {"key": "chair", "name": "餐椅", "type": "chair", "w": 460, "d": 520},
    "officeChair": {
        "key": "officeChair",
        "name": "办公椅",
        "type": "officeChair",
        "w": 600,
        "d": 600,
    },
}


def choices(*keys):
    return [{"request_index": index, "key": key} for index, key in enumerate(keys)]


def test_explicit_three_seat_sofa_rejects_armchair_and_small_sofa():
    additions = [{"query": "三人沙发", "count": 1}]
    assert not semantic_errors("三人沙发一个", additions, choices("sofa"), CATALOGUE)
    assert semantic_errors("三人沙发一个", additions, choices("armchair"), CATALOGUE)
    small = {**CATALOGUE, "smallSofa": {**CATALOGUE["sofa"], "key": "smallSofa", "w": 1500}}
    assert semantic_errors("三人沙发一个", additions, choices("smallSofa"), small)


def test_explicit_bed_size_is_checked_from_user_text_and_query():
    additions = [{"query": "双人床", "count": 1}]
    user = "主卧，1.8m 双人床一张"
    assert not semantic_errors(user, additions, choices("bed18"), CATALOGUE)
    assert semantic_errors(user, additions, choices("bed15"), CATALOGUE)
    guest = "次卧，1.5m 双人床、床头柜、衣柜各一"
    assert not semantic_errors(guest, additions, choices("bed15"), CATALOGUE)
    assert semantic_errors(guest, additions, choices("bed18"), CATALOGUE)


def test_explicit_dining_chairs_and_one_line_counter_keep_their_purpose():
    additions = [{"query": "餐椅", "count": 4}]
    assert not semantic_errors("餐椅四把", additions, choices("chair"), CATALOGUE)
    assert semantic_errors("餐椅四把", additions, choices("officeChair"), CATALOGUE)
    counter = [{"query": "一字橱柜", "count": 1}]
    assert not semantic_errors("一字橱柜一个", counter, choices("counter"), CATALOGUE)
    assert semantic_errors("一字橱柜一个", counter, choices("lCounter"), CATALOGUE)
