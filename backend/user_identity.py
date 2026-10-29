"""Cross-platform user identity helpers for review attribution."""
from __future__ import annotations

import getpass
import os
import unicodedata
from pathlib import Path


def _validate_userid_characters(userid: str) -> None:
    """Reject characters that can hide, reorder, split, or break serialized attribution."""
    if any(
        unicodedata.category(character).startswith("C")
        or unicodedata.category(character) in {"Zl", "Zp"}
        or (unicodedata.category(character) == "Zs" and character != " ")
        for character in userid
    ):
        raise ValueError(
            "userid must not contain non-printable, format, or non-ASCII separator characters"
        )


def _validated_default_candidate(userid: str) -> str:
    """Normalize one OS-account candidate, ignoring unsafe sources for fallback lookup."""
    try:
        _validate_userid_characters(userid)
    except ValueError:
        return ""
    return userid.strip()


def default_userid() -> str:
    """Return the validated local account name on Windows, Linux, or macOS.

    The value is attribution metadata, not an authenticated identity. ``getpass``
    handles the platform-specific lookup first; environment and home-directory
    fallbacks keep headless/container launches deterministic. Unsafe candidates
    are skipped rather than accepted or allowed to prevent server startup.
    """
    try:
        userid = _validated_default_candidate(getpass.getuser())
    except (OSError, KeyError):
        userid = ""

    if not userid:
        environment_keys = (
            ("USERNAME", "USER", "LOGNAME", "LNAME")
            if os.name == "nt"
            else ("LOGNAME", "USER", "LNAME", "USERNAME")
        )
        for key in environment_keys:
            candidate = _validated_default_candidate(os.environ.get(key, ""))
            if candidate:
                userid = candidate
                break

    if not userid:
        userid = _validated_default_candidate(Path.home().name)
    return userid or "unknown"


def normalize_userid(userid: str | None, *, fallback: str | None = None) -> str:
    """Trim and validate a userid, using a supplied or OS-account fallback when blank."""
    raw_userid = userid or ""
    _validate_userid_characters(raw_userid)
    normalized = raw_userid.strip()
    if not normalized:
        raw_fallback = fallback or default_userid()
        _validate_userid_characters(raw_fallback)
        normalized = raw_fallback.strip() or "unknown"
    if len(normalized) > 256:
        raise ValueError("userid must be 256 characters or fewer")
    return normalized
