"""
Direct-mode tests for the ContentModeration contract.

These run the contract Python code in-memory (no Docker, no network) in
milliseconds. Non-deterministic LLM calls are mocked with `direct_vm.mock_llm`.

Run from the project root:
    pytest contract/tests/test_direct.py -v
"""

import json

CONTRACT = "contract/content_moderation.py"
TOPIC = "GenLayer and blockchain development"


def _addr(account) -> str:
    """Return the 0x-hex address for a direct-mode account fixture.

    Direct-mode account fixtures are raw 20-byte `bytes`; the contract stores
    and returns addresses as 0x-hex strings, so we normalize here.
    """
    if isinstance(account, (bytes, bytearray)):
        return "0x" + bytes(account).hex()
    # Fall back to common accessors if the fixture is an object.
    addr = getattr(account, "address", account)
    return getattr(addr, "as_hex", str(addr))


def _approve(category="approved", reason="On-topic and respectful."):
    return json.dumps(
        {"decision": "APPROVE", "category": category, "reason": reason}
    )


def _reject(category="toxic", reason="Contains insults."):
    return json.dumps(
        {"decision": "REJECT", "category": category, "reason": reason}
    )


# --------------------------- pure storage tests ---------------------------

def test_initial_state(direct_deploy):
    c = direct_deploy(CONTRACT, TOPIC)
    assert c.get_topic() == TOPIC
    assert c.get_post_count() == 0
    assert c.get_approved_count() == 0


def test_reputation_unknown_author_is_zero(direct_deploy, direct_alice):
    c = direct_deploy(CONTRACT, TOPIC)
    assert c.get_reputation(_addr(direct_alice)) == 0


# --------------------------- moderation: approve ---------------------------

def test_submit_approved_post(direct_vm, direct_deploy, direct_alice):
    c = direct_deploy(CONTRACT, TOPIC)
    direct_vm.sender = direct_alice
    direct_vm.mock_llm(r".*content moderator.*", _approve())

    result = c.submit_post("GenLayer's optimistic democracy is fascinating!")
    assert result["approved"] is True
    assert result["category"] == "approved"

    assert c.get_post_count() == 1
    assert c.get_approved_count() == 1
    assert c.get_reputation(_addr(direct_alice)) == 1

    post = c.get_post(0)
    assert post["approved"] is True
    assert post["author"].lower() == _addr(direct_alice).lower()


# --------------------------- moderation: reject ---------------------------

def test_submit_rejected_post(direct_vm, direct_deploy, direct_alice):
    c = direct_deploy(CONTRACT, TOPIC)
    direct_vm.sender = direct_alice
    direct_vm.mock_llm(r".*content moderator.*", _reject())

    result = c.submit_post("You are all idiots and I hate this place")
    assert result["approved"] is False
    assert result["category"] == "toxic"

    assert c.get_post_count() == 1
    assert c.get_approved_count() == 0
    # Rejected post lowers reputation below zero.
    assert c.get_reputation(_addr(direct_alice)) == -1


# --------------------------- reputation accumulation ---------------------------

def test_reputation_accumulates(direct_vm, direct_deploy, direct_alice):
    c = direct_deploy(CONTRACT, TOPIC)
    direct_vm.sender = direct_alice

    direct_vm.mock_llm(r".*content moderator.*", _approve())
    c.submit_post("First on-topic post about smart contracts")
    c.submit_post("Second on-topic post about validators")

    direct_vm.clear_mocks()
    direct_vm.mock_llm(r".*content moderator.*", _reject(category="spam"))
    c.submit_post("BUY CHEAP FOLLOWERS NOW visit my link")

    # +1, +1, -1 = 1
    assert c.get_reputation(_addr(direct_alice)) == 1
    assert c.get_post_count() == 3
    assert c.get_approved_count() == 2


def test_posts_returned_newest_first(direct_vm, direct_deploy, direct_alice):
    c = direct_deploy(CONTRACT, TOPIC)
    direct_vm.sender = direct_alice
    direct_vm.mock_llm(r".*content moderator.*", _approve())

    c.submit_post("oldest post")
    c.submit_post("newest post")

    posts = c.get_posts()
    assert len(posts) == 2
    assert posts[0]["text"] == "newest post"
    assert posts[1]["text"] == "oldest post"


# --------------------------- edge cases ---------------------------

def test_empty_post_reverts(direct_vm, direct_deploy, direct_alice):
    c = direct_deploy(CONTRACT, TOPIC)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("post text cannot be empty"):
        c.submit_post("    ")


def test_too_long_post_reverts(direct_vm, direct_deploy, direct_alice):
    c = direct_deploy(CONTRACT, TOPIC)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("post text too long"):
        c.submit_post("x" * 2001)


def test_get_post_out_of_range_reverts(direct_vm, direct_deploy, direct_alice):
    c = direct_deploy(CONTRACT, TOPIC)
    with direct_vm.expect_revert("post index out of range"):
        c.get_post(0)


# --------------------------- consensus tests ---------------------------

def test_validator_agrees_on_same_decision(direct_vm, direct_deploy, direct_alice):
    """Leader approves; a validator that also approves should AGREE."""
    c = direct_deploy(CONTRACT, TOPIC)
    direct_vm.sender = direct_alice

    direct_vm.mock_llm(r".*content moderator.*", _approve())
    c.submit_post("A thoughtful post about GenLayer consensus")

    # Validator re-runs with a differently-worded but same APPROVE decision.
    direct_vm.clear_mocks()
    direct_vm.mock_llm(
        r".*content moderator.*",
        _approve(reason="Looks fine to me, on topic."),
    )
    assert direct_vm.run_validator() is True


def test_validator_disagrees_on_different_decision(direct_vm, direct_deploy, direct_alice):
    """Leader approves but a dissenting validator rejects -> DISAGREE."""
    c = direct_deploy(CONTRACT, TOPIC)
    direct_vm.sender = direct_alice

    direct_vm.mock_llm(r".*content moderator.*", _approve())
    c.submit_post("An ambiguous borderline post")

    direct_vm.clear_mocks()
    direct_vm.mock_llm(r".*content moderator.*", _reject())
    assert direct_vm.run_validator() is False

