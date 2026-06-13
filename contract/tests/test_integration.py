"""
Studio-mode integration test for the ContentModeration contract.

Unlike the direct tests, this deploys the contract to a real GenLayer
environment (localnet via `genlayer up`, or studionet) and drives it through
the JSON-RPC API with real multi-validator consensus and real LLM calls.

Prerequisites:
    - GenLayer Studio running locally:  genlayer init && genlayer up
      (or point gltest at studionet)

Run with the gltest CLI (NOT plain pytest), e.g.:
    gltest contract/tests/test_integration.py -v -s
    gltest contract/tests/test_integration.py -v -s --network studionet
"""

import pytest

from gltest import get_contract_factory
from gltest.assertions import tx_execution_succeeded


TOPIC = "GenLayer and blockchain development"


@pytest.fixture(scope="module")
def moderation_contract():
    """Deploy a fresh ContentModeration contract for the integration run."""
    factory = get_contract_factory("ContentModeration")
    contract = factory.deploy(args=[TOPIC])
    return contract


def test_topic_is_set(moderation_contract):
    assert moderation_contract.get_topic().call() == TOPIC


def test_on_topic_post_is_approved(moderation_contract):
    """A clearly on-topic, civil post should reach APPROVE consensus."""
    tx = moderation_contract.submit_post(
        args=[
            "I really enjoy how GenLayer validators reach consensus on "
            "subjective decisions using the Equivalence Principle."
        ]
    ).transact()
    assert tx_execution_succeeded(tx)

    count = moderation_contract.get_post_count().call()
    assert count >= 1

    # Newest post first.
    posts = moderation_contract.get_posts().call()
    assert posts[0]["approved"] is True


def test_toxic_post_is_rejected(moderation_contract):
    """An abusive, off-topic post should reach REJECT consensus."""
    tx = moderation_contract.submit_post(
        args=["You are all complete idiots and I hate every one of you."]
    ).transact()
    assert tx_execution_succeeded(tx)

    posts = moderation_contract.get_posts().call()
    assert posts[0]["approved"] is False
