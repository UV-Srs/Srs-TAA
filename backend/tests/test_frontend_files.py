"""The server hands out the frontend build's own files (logo, tab icon) instead of the app page."""
import sys

import pytest


@pytest.fixture
def main(client):
    """The app module, available only after the `client` fixture has pointed it at the test database."""
    return sys.modules["backend.app.main"]


def make_dist(tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>APP</html>")
    (dist / "srs-logo.png").write_bytes(b"\x89PNG\r\n\x1a\nfake-image-bytes")
    (tmp_path / "secret.txt").write_text("outside the build folder")
    return dist


def test_logo_is_served_as_an_image_not_the_app_page(client, main, monkeypatch, tmp_path):
    monkeypatch.setattr(main, "DIST_DIR", make_dist(tmp_path))
    r = client.get("/srs-logo.png")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("image/png")
    assert r.content.startswith(b"\x89PNG")


def test_app_routes_still_get_the_app_page(client, main, monkeypatch, tmp_path):
    monkeypatch.setattr(main, "DIST_DIR", make_dist(tmp_path))
    for path in ("/", "/templates", "/some/client/side/route", "/missing-file.png"):
        r = client.get(path)
        assert r.status_code == 200 and "APP" in r.text, path


def test_files_outside_the_build_folder_are_never_served(client, main, monkeypatch, tmp_path):
    monkeypatch.setattr(main, "DIST_DIR", make_dist(tmp_path))
    for path in ("/../secret.txt", "/..%2fsecret.txt", "/%2e%2e/secret.txt", "/assets/../../secret.txt"):
        r = client.get(path)
        assert "outside the build folder" not in r.text, path


def test_api_routes_are_unaffected(client, main, monkeypatch, tmp_path):
    monkeypatch.setattr(main, "DIST_DIR", make_dist(tmp_path))
    assert client.get("/api/health").json()["status"] == "healthy"
    assert client.get("/api/does-not-exist").json() == {"error": "Not Found"}
