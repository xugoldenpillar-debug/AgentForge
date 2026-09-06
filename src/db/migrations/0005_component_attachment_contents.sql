-- Store text attachment bodies separately from attachment metadata. The table is
-- intentionally repository-backed: no filesystem or object-storage dependency.
CREATE TABLE IF NOT EXISTS "component_attachment_contents" (
  "attachment_id" TEXT PRIMARY KEY REFERENCES "component_attachments"("id") ON DELETE CASCADE,
  "content" TEXT NOT NULL,
  CONSTRAINT "component_attachment_contents_content_size_check" CHECK (octet_length("content") <= 262144)
);
