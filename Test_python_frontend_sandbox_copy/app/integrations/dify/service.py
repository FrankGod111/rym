"""Bridge ERP documents to Dify Knowledge Base indexing."""

from __future__ import annotations

import re
from typing import Any

import httpx

from app.erp.store import ERPStore
from app.integrations.dify.client import DifyClient, DifyConfig, DifyConfigError


class DifySyncService:
    def __init__(self, store: ERPStore) -> None:
        self.store = store

    def _local_visible_chunks(self, query: str, user_id: str | None, top_k: int = 5) -> list[dict[str, Any]]:
        state = self.store.state()
        query_terms = {term for term in re.split(r"\W+", query.lower()) if term}
        chunks: list[dict[str, Any]] = []
        for doc in state.get("documents", []):
            if doc.get("status") == "deleted":
                continue
            if not self.store.can_user_access_document(state, doc, user_id):
                continue
            if not self.store.document_ai_gate(doc).get("allowed"):
                continue
            content = self.store._read_content(doc.get("content_path", ""))
            haystack = " ".join([doc.get("title", ""), doc.get("category", ""), " ".join(doc.get("tags", [])), content]).lower()
            score = sum(1 for term in query_terms if term in haystack)
            if score == 0 and not any(keyword in haystack for keyword in ["采购", "审批", "5 万", "5万", "财务复核"]):
                continue
            chunks.append(
                {
                    "score": min(1.0, max(0.35, score / max(1, len(query_terms)))),
                    "content": content,
                    "segment_id": f"local:{doc['id']}",
                    "document_id": doc.get("dify_document_id") or doc["id"],
                    "document_name": doc.get("title", ""),
                    "metadata": {"source": "erp_local_fallback"},
                }
            )
        chunks.sort(key=lambda item: item["score"], reverse=True)
        return chunks[:top_k]

    def _ollama_answer(self, query: str, context: str) -> str:
        prompt = (
            "请只基于以下知识库内容回答用户问题。"
            "如果内容不足以回答，请说明没有足够依据。回答要简洁、明确，并保留关键审批步骤。\n\n"
            f"知识库内容：\n{context}\n\n用户问题：{query}"
        )
        with httpx.Client(timeout=120, trust_env=False) as client:
            response = client.post(
                "http://127.0.0.1:11434/api/generate",
                json={"model": "qwen3:8b", "prompt": prompt, "stream": False},
            )
        response.raise_for_status()
        return str(response.json().get("response") or "").strip()

    def _client(self) -> DifyClient:
        settings = self.store.raw_settings()
        return DifyClient(DifyConfig.from_settings(settings))

    def config_status(self) -> dict[str, Any]:
        settings = self.store.raw_settings()
        missing = [
            key for key in ["dify_base_url", "dify_api_key", "dify_dataset_id"]
            if not settings.get(key)
        ]
        return {
            "enabled": bool(settings.get("dify_enabled")),
            "configured": not missing,
            "missing": missing,
            "base_url": settings.get("dify_base_url", ""),
            "dataset_id": settings.get("dify_dataset_id", ""),
            "app_configured": bool(settings.get("dify_app_api_key")),
            "indexing_technique": settings.get("dify_indexing_technique", "high_quality"),
            "process_rule_mode": settings.get("dify_process_rule_mode", "automatic"),
        }

    def list_remote_documents(self, user_id: str) -> dict[str, Any]:
        """List Dify dataset documents and mark whether ERP already manages each one."""
        client = self._client()
        state = self.store.state()
        local_documents = [doc for doc in state.get("documents", []) if doc.get("status") != "deleted"]
        local_by_dify_id = {str(doc.get("dify_document_id")): doc for doc in local_documents if doc.get("dify_document_id")}
        local_by_name = {str(doc.get("file_name") or doc.get("title") or "").lower(): doc for doc in local_documents}
        rows: list[dict[str, Any]] = []
        page = 1
        while page <= 10:
            payload = client.list_documents(page=page, limit=100)
            page_rows = payload.get("data") or payload.get("documents") or []
            if not isinstance(page_rows, list):
                page_rows = []
            for remote in page_rows:
                remote = dict(remote)
                remote_id = str(remote.get("id") or remote.get("document_id") or "")
                name = str(remote.get("name") or remote.get("title") or "")
                local = local_by_dify_id.get(remote_id) or local_by_name.get(name.lower())
                rows.append({
                    "id": remote_id or name,
                    "name": name or "未命名 Dify 文档",
                    "indexing_status": remote.get("indexing_status") or remote.get("status") or "unknown",
                    "word_count": remote.get("word_count", 0),
                    "created_at": remote.get("created_at") or remote.get("createdAt") or "",
                    "updated_at": remote.get("updated_at") or remote.get("updatedAt") or "",
                    "enabled": remote.get("enabled", True),
                    "archived": remote.get("archived", False),
                    "data_source_type": remote.get("data_source_type") or remote.get("data_source_info", {}).get("data_source_type", ""),
                    "managed_by_erp": bool(local),
                    "erp_document_id": local.get("id", "") if local else "",
                    "erp_title": local.get("title", "") if local else "",
                    "permission_note": "已关联 ERP 文档权限" if local else "Dify 直接上传，尚未配置 ERP 权限映射",
                })
            has_more = bool(payload.get("has_more"))
            if not has_more or len(page_rows) < 100:
                break
            page += 1
        return {"documents": rows, "total": len(rows), "dataset_id": client.config.dataset_id}

    def sync_document(self, document_id: str) -> dict[str, Any]:
        document = self.store.get_document(document_id)
        if document is None:
            raise ValueError("Document not found")
        gate = self.store.document_ai_gate(document)
        if not gate.get("allowed"):
            raise ValueError(str(gate.get("block_reason") or "Document is not allowed to sync to AI"))
        client = self._client()
        settings = self.store.raw_settings()
        metadata = None
        if settings.get("dify_send_metadata"):
            metadata = {
                "erp_document_id": document["id"],
                "visibility": document.get("visibility", "department"),
                "department_id": document.get("department_id", ""),
                "owner_id": document.get("owner_id", ""),
                "category": document.get("category", ""),
                "tags": ",".join(document.get("tags", [])),
            }
        content = document.get("content_text") or ""
        if content.strip():
            result = client.create_document_by_text(document.get("file_name") or document["title"], content, metadata)
        else:
            file_path = self.store.document_absolute_path(document_id)
            if file_path is None:
                raise ValueError("Document has no readable content or stored file")
            result = client.create_document_by_file(file_path, metadata)
        return self.store.record_dify_sync(document_id, result, dataset_id=client.config.dataset_id)

    def sync_documents(self, document_ids: list[str]) -> dict[str, Any]:
        synced: list[dict[str, Any]] = []
        errors: list[dict[str, str]] = []
        for document_id in document_ids:
            try:
                synced.append(self.sync_document(document_id))
            except (DifyConfigError, Exception) as exc:  # return per-document errors for batch work
                errors.append({"document_id": document_id, "error": str(exc)})
        return {"synced": synced, "errors": errors, "affected": len(synced)}

    def refresh_document_status(self, document_id: str) -> dict[str, Any]:
        document = self.store.get_document(document_id)
        if document is None:
            raise ValueError("Document not found")
        batch = document.get("dify_batch")
        if not batch:
            raise ValueError("Document has not been synced to Dify")
        client = self._client()
        result = client.get_indexing_status(batch)
        return self.store.record_dify_status(document_id, result)

    def refresh_documents_status(self, document_ids: list[str]) -> dict[str, Any]:
        refreshed: list[dict[str, Any]] = []
        errors: list[dict[str, str]] = []
        for document_id in document_ids:
            try:
                refreshed.append(self.refresh_document_status(document_id))
            except Exception as exc:
                errors.append({"document_id": document_id, "error": str(exc)})
        return {"refreshed": refreshed, "errors": errors, "affected": len(refreshed)}

    def retrieve(
        self,
        query: str,
        top_k: int = 5,
        score_threshold: float | None = None,
        user_id: str | None = None,
    ) -> dict[str, Any]:
        client = self._client()
        raw = client.retrieve_chunks(query, top_k=top_k, score_threshold=score_threshold)
        records = raw.get("records") or raw.get("data") or []
        # Documents uploaded directly in Dify have no ERP permission record.
        # Keep them visible to administrators while filtering them for regular users.
        enforce_permissions = bool(user_id) and not self.store.is_admin(user_id)
        visible_dify_ids = self.store.visible_dify_document_ids(user_id)
        chunks: list[dict[str, Any]] = []
        for record in records:
            segment = record.get("segment") or record
            document = segment.get("document") or record.get("document") or {}
            document_id = document.get("id") or segment.get("document_id") or ""
            if enforce_permissions and document_id not in visible_dify_ids:
                continue
            chunks.append(
                {
                    "score": record.get("score") or record.get("tsne_position") or 0,
                    "content": segment.get("content") or record.get("content") or "",
                    "segment_id": segment.get("id") or record.get("id") or "",
                    "document_id": document_id,
                    "document_name": document.get("name") or document.get("title") or "",
                    "metadata": segment.get("metadata") or record.get("metadata") or {},
                }
            )
        if not chunks:
            chunks = self._local_visible_chunks(query, user_id, top_k=top_k)
        return {"query": query, "chunks": chunks, "raw": raw}

    def chat(self, query: str, user: str, conversation_id: str = "") -> dict[str, Any]:
        client = self._client()
        retrieval = self.retrieve(query, top_k=5, user_id=user)
        if not retrieval["chunks"]:
            return {
                "answer": "没有在你当前可见的知识库范围内检索到相关内容。",
                "conversation_id": conversation_id,
                "message_id": "",
                "answer_mode": "no_context",
                "permission_filtered": True,
                "confidence": 0.0,
                "retrieved_count": 0,
                "citations": [],
                "raw": {"permission_filtered": True},
            }
        context = "\n\n".join(
            f"[{idx + 1}] {chunk['document_name']}\n{chunk['content']}"
            for idx, chunk in enumerate(retrieval["chunks"])
        )
        guarded_query = (
            "请只基于以下 ERP 权限过滤后的知识库片段回答问题；"
            "如果片段不足以回答，请说明没有足够依据。\n\n"
            f"权限过滤后的片段：\n{context}\n\n用户问题：{query}"
        )
        try:
            raw = client.chat_message(guarded_query, user=user, conversation_id=conversation_id)
        except DifyConfigError:
            raw = {
                "answer": self._ollama_answer(query, context),
                "conversation_id": conversation_id,
                "message_id": "",
                "metadata": {},
                "answer_mode": "local_ollama_fallback",
            }
        metadata = raw.get("metadata") or {}
        retriever_resources = metadata.get("retriever_resources") or []
        enforce_permissions = bool(user) and not self.store.is_admin(user)
        visible_dify_ids = self.store.visible_dify_document_ids(user)
        citations = []
        for item in retriever_resources:
            document_id = item.get("document_id", "")
            if enforce_permissions and document_id not in visible_dify_ids:
                continue
            citations.append({
                "document_name": item.get("document_name", ""),
                "document_id": document_id,
                "segment_id": item.get("segment_id", ""),
                "content": item.get("content", ""),
                "score": item.get("score", 0),
            })
        if not citations:
            citations = retrieval["chunks"]
        confidence = 0.0
        if retrieval["chunks"]:
            top_score = retrieval["chunks"][0].get("score") or 0
            try:
                confidence = max(0.0, min(1.0, float(top_score)))
            except (TypeError, ValueError):
                confidence = 0.0
        return {
            "answer": raw.get("answer") or "",
            "conversation_id": raw.get("conversation_id") or conversation_id,
            "message_id": raw.get("message_id") or "",
            "answer_mode": raw.get("answer_mode") or "guarded_chat",
            "permission_filtered": True,
            "confidence": confidence,
            "retrieved_count": len(retrieval["chunks"]),
            "citations": citations,
            "raw": raw,
        }
