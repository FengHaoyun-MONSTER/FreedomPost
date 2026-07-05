import { type ClipboardEvent, type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Bold,
  Code2,
  Italic,
  Link2,
  LogOut,
  Plus,
  RefreshCw,
  Save,
  Strikethrough,
  Trash2,
  Type,
  Underline,
  Upload
} from "lucide-react";
import "./styles.css";

type AdminPost = {
  id: string;
  slug: string;
  title: string;
  markdown: string;
  createdAt: string;
  updatedAt: string;
  viewCount: number;
  commentCount: number;
  attachmentCount: number;
};

type Toast = {
  id: number;
  text: string;
};

type UploadedFile = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  storageProvider: "local" | "oss" | "r2";
  storageKey: string;
};

const headingOptions = [
  { label: "正文", value: "p" },
  { label: "标题 1", value: "h1" },
  { label: "标题 2", value: "h2" },
  { label: "标题 3", value: "h3" }
] as const;

const sizeOptions = [
  { label: "小字", className: "fp-size-sm" },
  { label: "正文", className: "fp-size-md" },
  { label: "大字", className: "fp-size-lg" },
  { label: "强调", className: "fp-size-xl" }
] as const;

const colorOptions = [
  { label: "墨色", className: "fp-color-ink" },
  { label: "红色", className: "fp-color-red" },
  { label: "绿色", className: "fp-color-green" },
  { label: "蓝色", className: "fp-color-blue" },
  { label: "紫色", className: "fp-color-purple" },
  { label: "金色", className: "fp-color-gold" }
] as const;

function App() {
  const [isAuthed, setAuthed] = useState(false);
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [posts, setPosts] = useState<AdminPost[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const activePost = useMemo(() => posts.find((post) => post.id === activeId) ?? posts[0], [posts, activeId]);

  useEffect(() => {
    void fetchSession();
  }, []);

  useEffect(() => {
    if (!activePost || !editorRef.current) return;
    editorRef.current.innerHTML = markdownToEditorHtml(activePost.markdown);
  }, [activePost?.id]);

  useEffect(() => {
    const rememberEditorSelection = () => {
      const editor = editorRef.current;
      const selection = window.getSelection();
      if (!editor || !selection?.rangeCount || !editor.contains(selection.anchorNode)) return;
      savedRangeRef.current = selection.getRangeAt(0).cloneRange();
    };

    document.addEventListener("selectionchange", rememberEditorSelection);
    return () => document.removeEventListener("selectionchange", rememberEditorSelection);
  }, []);

  async function fetchSession() {
    const response = await fetch("/api/admin/session", { credentials: "include" });
    if (response.ok) {
      setAuthed(true);
      await loadPosts();
    }
  }

  async function login(event: FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ username, password })
    });

    if (!response.ok) {
      showToast("登录失败");
      return;
    }

    setAuthed(true);
    setPassword("");
    await loadPosts();
    showToast("已登录");
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST", credentials: "include" });
    setAuthed(false);
    setPosts([]);
  }

  async function loadPosts() {
    const response = await fetch("/api/admin/posts", { credentials: "include" });
    if (!response.ok) {
      setAuthed(false);
      return;
    }

    const body = (await response.json()) as { items: AdminPost[] };
    setPosts(body.items);
    setActiveId((current) => current ?? body.items[0]?.id ?? null);
  }

  async function createPost() {
    const response = await fetch("/api/admin/posts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        title: "未命名文章",
        markdown: "# 未命名文章\n\n开始写作。"
      })
    });

    if (!response.ok) {
      showToast("创建失败");
      return;
    }

    const created = (await response.json()) as AdminPost;
    setPosts((items) => [created, ...items]);
    setActiveId(created.id);
    showToast("文章已创建");
  }

  async function savePost() {
    if (!activePost) return;
    const markdown = editorRef.current ? editorHtmlToMarkdown(editorRef.current) : activePost.markdown;
    const response = await fetch(`/api/admin/posts/${activePost.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ title: activePost.title, markdown })
    });

    if (!response.ok) {
      showToast("保存失败");
      return;
    }

    const saved = (await response.json()) as AdminPost;
    setPosts((items) => items.map((item) => (item.id === saved.id ? saved : item)));
    showToast("保存成功，已公开");
  }

  async function deletePost() {
    if (!activePost) return;
    if (!confirm(`确认删除《${activePost.title}》？关联评论会一起删除。`)) return;

    const response = await fetch(`/api/admin/posts/${activePost.id}`, {
      method: "DELETE",
      credentials: "include"
    });

    if (!response.ok) {
      showToast("删除失败");
      return;
    }

    setPosts((items) => items.filter((item) => item.id !== activePost.id));
    setActiveId(null);
    showToast("文章已删除");
  }

  function patchActivePost(patch: Partial<AdminPost>) {
    if (!activePost) return;
    setPosts((items) => items.map((item) => (item.id === activePost.id ? { ...item, ...patch } : item)));
  }

  async function handleAttachmentFiles(files: FileList | null) {
    if (!activePost || !files?.length) return;
    try {
      const snippets = await Promise.all([...files].map(fileToEditorHtml));
      insertHtmlAtCaret(snippets.join(""));
      showToast(`已上传并插入 ${files.length} 个附件`);
    } catch {
      showToast("附件上传失败");
    }
  }

  async function handleEditorPaste(event: ClipboardEvent<HTMLDivElement>) {
    const files = [...event.clipboardData.items]
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));

    if (files.length) {
      event.preventDefault();
      try {
        const snippets = await Promise.all(files.map(fileToEditorHtml));
        insertHtmlAtCaret(snippets.join(""));
        showToast("图片已上传并插入");
      } catch {
        showToast("图片上传失败");
      }
      return;
    }

    const htmlWithImages = await pastedHtmlToEditorHtml(event.clipboardData.getData("text/html"));
    if (!htmlWithImages) return;

    event.preventDefault();
    insertHtmlAtCaret(htmlWithImages);
    showToast("图片已上传并插入");
  }

  function insertHtmlAtCaret(html: string) {
    if (!activePost) return;
    const editor = editorRef.current;
    if (!editor) return;

    editor.focus();
    const selection = window.getSelection();
    const template = document.createElement("template");
    template.innerHTML = html;
    const fragment = template.content;
    const lastNode = fragment.lastChild;
    const insertsRichBlock = Boolean(fragment.querySelector("figure.editor-image,.editor-attachment"));

    if (selection?.rangeCount && editor.contains(selection.anchorNode)) {
      const range = selection.getRangeAt(0);
      const block = closestEditableBlock(selection.anchorNode, editor);
      if (insertsRichBlock && block) {
        block.after(fragment);
      } else {
        range.deleteContents();
        range.insertNode(fragment);
      }
      if (lastNode) {
        range.setStartAfter(lastNode);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    } else {
      editor.append(fragment);
    }

    syncEditorMarkdown();
  }

  function restoreEditorSelection() {
    const editor = editorRef.current;
    if (!editor) return;

    editor.focus();
    const range = savedRangeRef.current;
    const selection = window.getSelection();
    if (!range || !selection || !editor.contains(range.commonAncestorContainer)) return;

    selection.removeAllRanges();
    selection.addRange(range);
  }

  function runEditorCommand(command: string, value?: string) {
    if (!activePost) return;
    restoreEditorSelection();
    document.execCommand(command, false, value);
    syncEditorMarkdown();
  }

  function applyBlockFormat(tagName: string) {
    runEditorCommand("formatBlock", tagName);
  }

  function applyInlineClass(className: string) {
    if (!activePost) return;
    restoreEditorSelection();

    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount || !editor.contains(selection.anchorNode) || selection.isCollapsed) {
      showToast("请先选中文本");
      return;
    }

    const range = selection.getRangeAt(0);
    const span = document.createElement("span");
    span.className = className;

    try {
      range.surroundContents(span);
    } catch {
      span.append(range.extractContents());
      range.insertNode(span);
    }

    const nextRange = document.createRange();
    nextRange.selectNodeContents(span);
    selection.removeAllRanges();
    selection.addRange(nextRange);
    savedRangeRef.current = nextRange.cloneRange();
    syncEditorMarkdown();
  }

  function createLinkAtSelection() {
    const href = prompt("输入链接地址");
    if (!href) return;

    try {
      const url = new URL(href, location.origin);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        showToast("只支持 http/https 链接");
        return;
      }
      runEditorCommand("createLink", url.toString());
    } catch {
      showToast("链接地址无效");
    }
  }

  function insertCodeBlock() {
    insertHtmlAtCaret('<pre data-lang="ts"><code>// code</code></pre><p><br></p>');
  }

  function closestEditableBlock(node: Node | null, editor: HTMLElement): HTMLElement | null {
    const start = node instanceof HTMLElement ? node : node?.parentElement;
    const block = start?.closest("p,h1,h2,h3,h4,h5,h6,li,blockquote,pre");
    return block instanceof HTMLElement && editor.contains(block) ? block : null;
  }

  function syncEditorMarkdown() {
    if (!activePost || !editorRef.current) return;
    patchActivePost({ markdown: editorHtmlToMarkdown(editorRef.current) });
  }

  function showToast(text: string) {
    const id = Date.now();
    setToast({ id, text });
    window.setTimeout(() => {
      setToast((current) => (current?.id === id ? null : current));
    }, 1800);
  }

  if (!isAuthed) {
    return (
      <main className="login-screen">
        <form className="login-box" onSubmit={login}>
          <div>
            <h1>FreedomPost</h1>
            <p>管理员登录</p>
          </div>
          <label>
            <span>账号</span>
            <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
          </label>
          <label>
            <span>密码</span>
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              type="password"
            />
          </label>
          <button className="primary" type="submit">
            登录
          </button>
        </form>
        {toast && <div className="toast">{toast.text}</div>}
      </main>
    );
  }

  return (
    <main className="admin-shell">
      <aside className="post-rail">
        <div className="rail-head">
          <strong>文章管理</strong>
          <button className="icon-button" type="button" onClick={createPost} title="新建文章">
            <Plus size={17} />
          </button>
        </div>
        <div className="rail-actions">
          <button type="button" onClick={loadPosts}>
            <RefreshCw size={15} />
            刷新
          </button>
          <button type="button" onClick={logout}>
            <LogOut size={15} />
            退出
          </button>
        </div>
        <div className="post-list">
          {posts.map((post) => (
            <button
              key={post.id}
              type="button"
              className={post.id === activePost?.id ? "active" : ""}
              onClick={() => setActiveId(post.id)}
            >
              <span>{post.title}</span>
              <small>
                {formatDate(post.updatedAt)} · {post.viewCount} 访问 · {post.commentCount} 评论
              </small>
            </button>
          ))}
        </div>
      </aside>

      <section className="editor-pane">
        {activePost ? (
          <>
            <header className="editor-topbar">
              <div>
                <strong>{activePost.title}</strong>
                <span>/p/{activePost.slug}</span>
              </div>
            </header>
            <div className="editor-workspace">
              <label className="title-field">
                <span>标题</span>
                <input value={activePost.title} onChange={(event) => patchActivePost({ title: event.target.value })} />
              </label>
              <div
                ref={editorRef}
                className="rich-editor"
                contentEditable
                suppressContentEditableWarning
                role="textbox"
                aria-label="文章正文"
                onInput={syncEditorMarkdown}
                onPaste={handleEditorPaste}
              />
            </div>
            <div className="toolbar" aria-label="编辑工具栏">
              <label className="toolbar-field">
                <Type size={15} aria-hidden="true" />
                <select
                  aria-label="标题级别"
                  defaultValue="p"
                  onChange={(event) => {
                    applyBlockFormat(event.target.value);
                    event.target.value = "p";
                  }}
                >
                  {headingOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <span className="toolbar-divider" />
              <button
                className="icon-button"
                type="button"
                title="加粗"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => runEditorCommand("bold")}
              >
                <Bold size={16} />
              </button>
              <button
                className="icon-button"
                type="button"
                title="删除线"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => runEditorCommand("strikeThrough")}
              >
                <Strikethrough size={16} />
              </button>
              <button
                className="icon-button"
                type="button"
                title="斜体"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => runEditorCommand("italic")}
              >
                <Italic size={16} />
              </button>
              <button
                className="icon-button"
                type="button"
                title="下划线"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => runEditorCommand("underline")}
              >
                <Underline size={16} />
              </button>
              <button
                className="icon-button"
                type="button"
                title="插入链接"
                onMouseDown={(event) => event.preventDefault()}
                onClick={createLinkAtSelection}
              >
                <Link2 size={16} />
              </button>
              <button
                className="icon-button"
                type="button"
                title="代码块"
                onMouseDown={(event) => event.preventDefault()}
                onClick={insertCodeBlock}
              >
                <Code2 size={16} />
              </button>
              <label className="toolbar-field">
                <span>字号</span>
                <select
                  aria-label="字号"
                  defaultValue=""
                  onChange={(event) => {
                    if (event.target.value) {
                      applyInlineClass(event.target.value);
                    }
                    event.target.value = "";
                  }}
                >
                  <option value="" disabled>
                    选择
                  </option>
                  {sizeOptions.map((option) => (
                    <option key={option.className} value={option.className}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="color-group" role="group" aria-label="字体颜色">
                {colorOptions.map((option) => (
                  <button
                    key={option.className}
                    className={`swatch-button ${option.className}`}
                    type="button"
                    title={option.label}
                    aria-label={option.label}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applyInlineClass(option.className)}
                  >
                    <span />
                  </button>
                ))}
              </div>
              <span className="toolbar-divider" />
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => attachmentInputRef.current?.click()}
              >
                <Upload size={15} />
                附件
              </button>
              <input
                ref={attachmentInputRef}
                className="hidden-input"
                type="file"
                multiple
                onChange={(event) => {
                  void handleAttachmentFiles(event.target.files);
                  event.target.value = "";
                }}
              />
              <span className="toolbar-fill" />
              <button className="danger-button" type="button" onClick={deletePost}>
                <Trash2 size={15} />
                删除
              </button>
              <button className="primary" type="button" onClick={savePost}>
                <Save size={15} />
                保存
              </button>
            </div>
          </>
        ) : (
          <div className="empty-state">暂无文章</div>
        )}
      </section>
      {toast && <div className="toast">{toast.text}</div>}
    </main>
  );
}

async function fileToEditorHtml(file: File): Promise<string> {
  const uploaded = await uploadFile(file);
  if (uploaded.mimeType.startsWith("image/")) {
    return `${editorImageHtml(uploaded.url, uploaded.name)}<p><br></p>`;
  }

  return `<div class="editor-attachment" data-fp-type="attachment" data-name="${escapeAttribute(uploaded.name)}" data-href="${escapeAttribute(uploaded.url)}" contenteditable="false"><span>${escapeHtml(uploaded.name)}</span><a href="${escapeAttribute(uploaded.url)}" download="${escapeAttribute(uploaded.name)}">下载 / 查看</a></div><p><br></p>`;
}

async function pastedHtmlToEditorHtml(html: string): Promise<string | null> {
  if (!html || !/<img[\s>]/i.test(html)) return null;

  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll("script,style").forEach((node) => node.remove());
  const images = [...template.content.querySelectorAll<HTMLImageElement>("img")];
  let replaced = false;

  for (const image of images) {
    const src = image.getAttribute("src") ?? "";
    const alt = image.getAttribute("alt") || image.getAttribute("title") || filenameFromUrl(src) || "image.png";
    const uploaded = await uploadEmbeddedImage(src, alt);
    const imageUrl = uploaded?.url ?? normalizeImageSource(src);

    if (!imageUrl) continue;

    const replacement = document.createElement("template");
    replacement.innerHTML = editorImageHtml(imageUrl, uploaded?.name ?? alt);
    image.replaceWith(replacement.content);
    replaced = true;
  }

  return replaced ? template.innerHTML : null;
}

async function uploadEmbeddedImage(src: string, name: string): Promise<UploadedFile | null> {
  if (!src.startsWith("data:") && !src.startsWith("blob:")) {
    return null;
  }

  const response = await fetch(src);
  const blob = await response.blob();
  const file = new File([blob], filenameWithImageExtension(name, blob.type), { type: blob.type || "image/png" });
  return uploadFile(file);
}

function editorImageHtml(url: string, name: string): string {
  const safeUrl = escapeAttribute(url);
  const safeName = escapeAttribute(name || "image.png");
  return `<figure class="editor-image" data-fp-type="image"><a href="${safeUrl}" target="_blank" rel="noreferrer noopener"><img src="${safeUrl}" alt="${safeName}" /></a><figcaption>${escapeHtml(name || "image.png")}</figcaption></figure>`;
}

async function uploadFile(file: File): Promise<UploadedFile> {
  const formData = new FormData();
  formData.set("file", file);

  const response = await fetch("/api/admin/attachments", {
    method: "POST",
    credentials: "include",
    body: formData
  });

  if (!response.ok) {
    throw new Error("Upload failed");
  }

  const payload = (await response.json()) as { file: UploadedFile };
  return payload.file;
}

function normalizeImageSource(src: string): string | null {
  if (!src) return null;

  try {
    const url = new URL(src, location.origin);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function filenameFromUrl(src: string): string | null {
  if (!src) return null;

  try {
    const url = new URL(src, location.origin);
    return decodeURIComponent(url.pathname.split("/").pop() || "") || null;
  } catch {
    return null;
  }
}

function filenameWithImageExtension(name: string, mimeType: string): string {
  const cleanName = name.trim() || "image";
  if (/\.[a-z0-9]{2,5}$/i.test(cleanName)) {
    return cleanName;
  }

  const extensions: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg"
  };

  return `${cleanName}.${extensions[mimeType.toLowerCase().split(";")[0] ?? ""] ?? "png"}`;
}

function markdownToEditorHtml(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const html: string[] = [];
  let paragraph: string[] = [];
  let codeLines: string[] | null = null;
  let codeLang = "";

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${formatInlineMarkdown(paragraph.join("<br>"))}</p>`);
    paragraph = [];
  };

  for (const line of lines) {
    const fence = line.match(/^```(\w+)?\s*$/);
    if (fence) {
      if (codeLines) {
        html.push(`<pre data-lang="${escapeAttribute(codeLang)}"><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = null;
        codeLang = "";
      } else {
        flushParagraph();
        codeLines = [];
        codeLang = fence[1] ?? "";
      }
      continue;
    }

    if (codeLines) {
      codeLines.push(line);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    const image = line.match(/^!\[(.*)]\((.*)\)$/);
    if (image) {
      flushParagraph();
      html.push(editorImageHtml(image[2] ?? "", image[1] ?? "image.png"));
      continue;
    }

    const attachment = line.match(/^\[附件[:：]\s*(.+?)]\((.+)\)$/);
    if (attachment) {
      flushParagraph();
      html.push(`<div class="editor-attachment" data-fp-type="attachment" data-name="${escapeAttribute(attachment[1] ?? "")}" data-href="${escapeAttribute(attachment[2] ?? "")}" contenteditable="false"><span>${escapeHtml(attachment[1] ?? "")}</span><a href="${escapeAttribute(attachment[2] ?? "")}" download="${escapeAttribute(attachment[1] ?? "")}">下载 / 查看</a></div>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      const level = heading[1]?.length ?? 1;
      html.push(`<h${level}>${formatInlineMarkdown(escapeHtml(heading[2] ?? ""))}</h${level}>`);
      continue;
    }

    paragraph.push(escapeHtml(line));
  }

  if (codeLines) {
    html.push(`<pre data-lang="${escapeAttribute(codeLang)}"><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  }
  flushParagraph();

  return html.join("") || "<p><br></p>";
}

function editorHtmlToMarkdown(editor: HTMLElement): string {
  const blocks: string[] = [];

  for (const node of [...editor.childNodes]) {
    const markdown = nodeToMarkdown(node);
    if (markdown.trim()) {
      blocks.push(markdown);
    }
  }

  return blocks.join("\n\n");
}

function nodeToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent?.trim() ?? "";
  }

  if (!(node instanceof HTMLElement)) {
    return "";
  }

  if (node.matches("figure.editor-image")) {
    const img = node.querySelector("img");
    if (!img) return "";
    return `![${escapeMarkdown(img.alt || node.querySelector("figcaption")?.textContent?.trim() || "图片")}](${img.src})`;
  }

  if (node.matches(".editor-attachment")) {
    const name = node.dataset.name || node.querySelector("span")?.textContent?.trim() || "附件";
    const href = node.dataset.href || node.querySelector("a")?.getAttribute("href") || "#";
    return `[附件: ${escapeMarkdown(name)}](${href})`;
  }

  if (node.tagName === "IMG") {
    const img = node as HTMLImageElement;
    return `![${escapeMarkdown(img.alt || "图片")}](${img.src})`;
  }

  if (node.querySelector("figure.editor-image,img,.editor-attachment")) {
    const childMarkdown = [...node.childNodes].map(nodeToMarkdown).filter((value) => value.trim());
    if (childMarkdown.length) {
      return childMarkdown.join("\n\n");
    }
  }

  if (/^H[1-6]$/.test(node.tagName)) {
    const level = Number(node.tagName.slice(1));
    return `${"#".repeat(level)} ${inlineChildrenToMarkdown(node).trim()}`;
  }

  if (node.tagName === "PRE") {
    const lang = node.dataset.lang ?? "";
    return `\`\`\`${lang}\n${node.textContent?.replace(/\n$/, "") ?? ""}\n\`\`\``;
  }

  if (node.tagName === "UL" || node.tagName === "OL") {
    return [...node.querySelectorAll<HTMLElement>(":scope > li")]
      .map((li, index) => `${node.tagName === "OL" ? `${index + 1}.` : "-"} ${inlineChildrenToMarkdown(li).trim()}`)
      .join("\n");
  }

  return inlineChildrenToMarkdown(node).trim();
}

function inlineChildrenToMarkdown(node: HTMLElement): string {
  return [...node.childNodes].map(inlineNodeToMarkdown).join("");
}

function inlineNodeToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }

  if (!(node instanceof HTMLElement)) {
    return "";
  }

  if (node.tagName === "BR") {
    return "\n";
  }

  if (node.tagName === "IMG") {
    const img = node as HTMLImageElement;
    return `![${escapeMarkdown(img.alt || "图片")}](${img.src})`;
  }

  if (node.matches("figure.editor-image,.editor-attachment")) {
    return nodeToMarkdown(node);
  }

  const content = inlineChildrenToMarkdown(node);

  if (node.tagName === "A" && node.querySelector("img")) {
    return content;
  }

  if (node.tagName === "A") {
    const href = node.getAttribute("href") ?? "";
    return href ? `[${content || href}](${href})` : content;
  }

  if (node.tagName === "STRONG" || node.tagName === "B") {
    return `**${content}**`;
  }

  if (node.tagName === "EM" || node.tagName === "I") {
    return `*${content}*`;
  }

  if (node.tagName === "DEL" || node.tagName === "S" || node.tagName === "STRIKE") {
    return `~~${content}~~`;
  }

  if (node.tagName === "U") {
    return `<u>${content}</u>`;
  }

  if (node.tagName === "CODE") {
    return `\`${node.textContent ?? ""}\``;
  }

  if (node.tagName === "SPAN") {
    const className = sanitizeInlineClassList([...node.classList].join(" "));
    return className ? `<span class="${className}">${content}</span>` : content;
  }

  return content || (node.textContent ?? "");
}

function formatInlineMarkdown(value: string): string {
  return restoreSafeInlineHtml(value
    .replace(/\[([^\]]+)]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/~~(.*?)~~/g, "<del>$1</del>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>"));
}

function restoreSafeInlineHtml(value: string): string {
  return value
    .replace(/&lt;u&gt;([\s\S]*?)&lt;\/u&gt;/g, "<u>$1</u>")
    .replace(/&lt;span class=&quot;([^&]+)&quot;&gt;([\s\S]*?)&lt;\/span&gt;/g, (_match, className: string, content: string) => {
      const safeClassName = sanitizeInlineClassList(className);
      return safeClassName ? `<span class="${safeClassName}">${content}</span>` : content;
    });
}

function sanitizeInlineClassList(value: string): string {
  const allowedClasses = new Set<string>([
    ...sizeOptions.map((option) => option.className),
    ...colorOptions.map((option) => option.className)
  ]);
  return value
    .split(/\s+/)
    .map((className) => className.trim())
    .filter((className) => allowedClasses.has(className))
    .join(" ");
}

function escapeMarkdown(value: string): string {
  return value.replaceAll("[", "\\[").replaceAll("]", "\\]").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll("\n", "&#10;");
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}

createRoot(document.getElementById("root")!).render(<App />);
