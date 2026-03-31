"""HTTP client for the RewindAI backend."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx


class ApiError(RuntimeError):
    """Raised when the backend returns an error."""


@dataclass
class RewindApi:
    base_url: str
    user_id: str
    timeout: float = 60.0

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        payload: dict[str, Any] | None = None,
    ) -> Any:
        url = f"{self.base_url.rstrip('/')}{path}"
        with httpx.Client(timeout=self.timeout) as client:
            try:
                response = client.request(method, url, params=params, json=payload)
            except httpx.HTTPError as exc:
                raise ApiError(f"Failed to reach RewindAI backend at {self.base_url}: {exc}") from exc

        if response.status_code >= 400:
            try:
                detail = response.json().get("detail")
            except Exception:
                detail = response.text
            raise ApiError(detail or f"Backend request failed: {response.status_code}")

        if not response.content:
            return None
        return response.json()

    def status(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/workspace/status", params={"user_id": self.user_id})

    def branches(self) -> list[dict[str, Any]]:
        return self._request("GET", "/api/v1/branches")

    def create_branch(self, name: str, source_ref: str) -> dict[str, Any]:
        return self._request(
            "POST",
            "/api/v1/branches",
            payload={"branch_name": name, "source_ref": source_ref, "user_id": self.user_id},
        )

    def checkout(self, ref: str, reuse_session: bool = False) -> dict[str, Any]:
        return self._request(
            "POST",
            "/api/v1/workspace/checkout",
            payload={"ref": ref, "user_id": self.user_id, "reuse_session": reuse_session},
        )

    def attach_branch(self, branch_name: str, reuse_session: bool = False) -> dict[str, Any]:
        return self._request(
            "POST",
            "/api/v1/workspace/attach-branch",
            payload={"branch_name": branch_name, "user_id": self.user_id, "reuse_session": reuse_session},
        )

    def log(self, ref: str | None = None) -> list[dict[str, Any]]:
        params = {"user_id": self.user_id}
        if ref:
            params["ref"] = ref
        return self._request("GET", "/api/v1/log", params=params)

    def diff(self, ref_a: str, ref_b: str) -> dict[str, Any]:
        return self._request("POST", "/api/v1/diff", payload={"ref_a": ref_a, "ref_b": ref_b})

    def chat(self, message: str) -> dict[str, Any]:
        return self._request("POST", "/api/v1/chat", payload={"message": message, "user_id": self.user_id})

    def commit(self, message: str) -> dict[str, Any]:
        return self._request(
            "POST",
            "/api/v1/workspace/commit",
            payload={"message": message, "user_id": self.user_id},
        )

    def merge_preview(self, source_branch: str, target_branch: str | None = None) -> dict[str, Any]:
        params = {"source_branch": source_branch, "user_id": self.user_id}
        if target_branch:
            params["target_branch"] = target_branch
        return self._request("GET", "/api/v1/workspace/merge-preview", params=params)

    def merge(
        self,
        source_branch: str,
        *,
        target_branch: str | None = None,
        strategy: str = "auto",
        resolutions: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "source_branch": source_branch,
            "strategy": strategy,
            "user_id": self.user_id,
            "resolutions": resolutions or [],
        }
        if target_branch:
            payload["target_branch"] = target_branch
        return self._request("POST", "/api/v1/workspace/merge", payload=payload)

    def health(self) -> dict[str, Any]:
        return self._request("GET", "/health")

    def timeline(self, branch_name: str) -> list[dict[str, Any]]:
        return self._request("GET", f"/api/v1/timeline/{branch_name}")

    def commit_snapshot(self, commit_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/v1/commits/{commit_id}/snapshot")

    def graph_branch(self, branch_name: str) -> dict[str, Any]:
        return self._request("GET", f"/api/v1/graph/branch/{branch_name}")

    def memories(self, branch_name: str) -> list[dict[str, Any]]:
        return self._request("GET", "/api/v1/memories", params={"branch_name": branch_name})
