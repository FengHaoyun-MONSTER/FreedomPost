import { type ClipboardEvent, type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Bold,
  Code2,
  ImagePlus,
  Italic,
  Link2,
  LogOut,
  Package,
  Plus,
  RefreshCw,
  Save,
  Strikethrough,
  Trash2,
  Type,
  Underline,
  Upload
} from "lucide-react";
import { editorImageHtml } from "./editor-media.js";
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
  visibility: "public" | "private";
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
  storedFilename: string;
};

type AdminProduct = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  description: string;
  category: string;
  priceCents: number;
  commissionCents: number;
  compareAtCents: number | null;
  currency: string;
  stock: number;
  soldCount: number;
  coverUrl: string | null;
  status: "draft" | "published";
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

type AdminTool = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  description: string;
  category: string;
  url: string;
  coverUrl: string | null;
  status: "draft" | "published";
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

type AdminAffiliate = {
  id: string;
  wechatId: string;
  status: "active" | "disabled";
  totalClicks: number;
  uniqueClicks: number;
  orderCount: number;
  createdAt: string;
};

type AdminAffiliateOrder = {
  id: string;
  orderCode: string;
  affiliateWechatId: string;
  productTitle: string;
  priceCents: number;
  commissionCents: number;
  currency: string;
  orderStatus: "pending" | "completed" | "canceled";
  commissionStatus: "not_due" | "pending" | "paid";
  createdAt: string;
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
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [tools, setTools] = useState<AdminTool[]>([]);
  const [affiliates, setAffiliates] = useState<AdminAffiliate[]>([]);
  const [affiliateOrders, setAffiliateOrders] = useState<AdminAffiliateOrder[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<"posts" | "products" | "tools" | "distribution">("posts");
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
      await Promise.all([loadPosts(), loadProducts(), loadTools(), loadDistribution()]);
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
    await Promise.all([loadPosts(), loadProducts(), loadTools(), loadDistribution()]);
    showToast("已登录");
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST", credentials: "include" });
    setAuthed(false);
    setPosts([]);
    setProducts([]);
    setTools([]);
    setAffiliates([]);
    setAffiliateOrders([]);
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

  async function loadProducts() {
    const response = await fetch("/api/admin/products", { credentials: "include" });
    if (!response.ok) return;
    const body = (await response.json()) as { items: AdminProduct[] };
    setProducts(body.items);
  }

  async function loadTools() {
    const response = await fetch("/api/admin/tools", { credentials: "include" });
    if (!response.ok) return;
    setTools(((await response.json()) as { items: AdminTool[] }).items);
  }

  async function loadDistribution() {
    const [affiliateResponse, orderResponse] = await Promise.all([
      fetch("/api/admin/affiliates", { credentials: "include" }),
      fetch("/api/admin/affiliate-orders", { credentials: "include" })
    ]);
    if (affiliateResponse.ok) setAffiliates(((await affiliateResponse.json()) as { items: AdminAffiliate[] }).items);
    if (orderResponse.ok) setAffiliateOrders(((await orderResponse.json()) as { items: AdminAffiliateOrder[] }).items);
  }

  function openProductWorkspace() {
    setWorkspace("products");
    void loadProducts();
  }

  function openToolsWorkspace() {
    setWorkspace("tools");
    void loadTools();
  }

  async function createPost() {
    const response = await fetch("/api/admin/posts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        title: "未命名文章",
        markdown: "# 未命名文章\n\n开始写作。",
        visibility: "public"
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
      body: JSON.stringify({ title: activePost.title, markdown, visibility: activePost.visibility })
    });

    if (!response.ok) {
      showToast("保存失败");
      return;
    }

    const saved = (await response.json()) as AdminPost;
    setPosts((items) => items.map((item) => (item.id === saved.id ? saved : item)));
    showToast(saved.visibility === "private" ? "保存成功，仅自己可见" : "保存成功，文章已公开");
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

  if (workspace === "products") {
    return (
      <ProductWorkspace
        products={products}
        setProducts={setProducts}
        onOpenPosts={() => setWorkspace("posts")}
        onOpenTools={openToolsWorkspace}
        onOpenDistribution={() => { setWorkspace("distribution"); void loadDistribution(); }}
        onRefresh={loadProducts}
        onLogout={logout}
        showToast={showToast}
        toast={toast}
      />
    );
  }

  if (workspace === "tools") {
    return <ToolWorkspace tools={tools} setTools={setTools} onOpenPosts={() => setWorkspace("posts")} onOpenProducts={openProductWorkspace} onOpenDistribution={() => { setWorkspace("distribution"); void loadDistribution(); }} onRefresh={loadTools} onLogout={logout} showToast={showToast} toast={toast} />;
  }

  if (workspace === "distribution") {
    return <DistributionWorkspace affiliates={affiliates} orders={affiliateOrders} setAffiliates={setAffiliates} setOrders={setAffiliateOrders} onOpenPosts={() => setWorkspace("posts")} onOpenProducts={openProductWorkspace} onOpenTools={openToolsWorkspace} onRefresh={loadDistribution} onLogout={logout} showToast={showToast} toast={toast} />;
  }

  return (
    <main className="admin-shell">
      <aside className="post-rail">
        <div className="workspace-tabs" role="tablist" aria-label="后台工作区">
          <button className="active" type="button" role="tab" aria-selected="true">文章</button>
          <button type="button" role="tab" aria-selected="false" onClick={openProductWorkspace}>商品</button>
          <button type="button" role="tab" aria-selected="false" onClick={openToolsWorkspace}>工具</button>
          <button type="button" role="tab" aria-selected="false" onClick={() => { setWorkspace("distribution"); void loadDistribution(); }}>分销</button>
        </div>
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
              <label className="post-visibility-field">
                <span>文章可见性</span>
                <select value={activePost.visibility} onChange={(event) => patchActivePost({ visibility: event.target.value as AdminPost["visibility"] })}>
                  <option value="public">公开，所有人可见</option>
                  <option value="private">私密，仅自己可见</option>
                </select>
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

function ProductWorkspace({
  products,
  setProducts,
  onOpenPosts,
  onOpenDistribution,
  onOpenTools,
  onRefresh,
  onLogout,
  showToast,
  toast
}: {
  products: AdminProduct[];
  setProducts: (next: AdminProduct[] | ((items: AdminProduct[]) => AdminProduct[])) => void;
  onOpenPosts: () => void;
  onOpenDistribution: () => void;
  onOpenTools: () => void;
  onRefresh: () => Promise<void>;
  onLogout: () => Promise<void>;
  showToast: (text: string) => void;
  toast: Toast | null;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const activeProduct = useMemo(() => products.find((product) => product.id === activeId) ?? products[0], [products, activeId]);

  useEffect(() => {
    setActiveId((current) => current ?? products[0]?.id ?? null);
  }, [products]);

  function patchProduct(patch: Partial<AdminProduct>) {
    if (!activeProduct) return;
    setProducts((items) => items.map((item) => (item.id === activeProduct.id ? { ...item, ...patch } : item)));
  }

  async function createProduct() {
    const response = await fetch("/api/admin/products", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify(defaultProductPayload())
    });
    if (!response.ok) return showToast("创建商品失败");
    const created = (await response.json()) as AdminProduct;
    setProducts((items) => [created, ...items]);
    setActiveId(created.id);
    showToast("商品草稿已创建");
  }

  async function saveProduct() {
    if (!activeProduct) return;
    const response = await fetch(`/api/admin/products/${activeProduct.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify(productPayload(activeProduct))
    });
    if (!response.ok) return showToast("保存失败，请检查商品信息");
    const saved = (await response.json()) as AdminProduct;
    setProducts((items) => items.map((item) => (item.id === saved.id ? saved : item)));
    showToast(saved.status === "published" ? "商品已发布" : "商品草稿已保存");
  }

  async function deleteProduct() {
    if (!activeProduct || !confirm(`确认删除商品《${activeProduct.title}》？`)) return;
    const response = await fetch(`/api/admin/products/${activeProduct.id}`, { method: "DELETE", credentials: "include" });
    if (!response.ok) return showToast("删除失败");
    setProducts((items) => items.filter((item) => item.id !== activeProduct.id));
    setActiveId(null);
    showToast("商品已删除");
  }

  async function uploadCover(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return showToast("封面只能使用图片文件");
    try {
      const uploaded = await uploadFile(file);
      patchProduct({ coverUrl: uploaded.url });
      showToast("封面已上传，保存商品后生效");
    } catch {
      showToast("封面上传失败");
    }
  }

  return (
    <main className="admin-shell">
      <aside className="post-rail">
        <div className="workspace-tabs" role="tablist" aria-label="后台工作区">
          <button type="button" role="tab" aria-selected="false" onClick={onOpenPosts}>文章</button>
          <button className="active" type="button" role="tab" aria-selected="true">商品</button>
          <button type="button" role="tab" aria-selected="false" onClick={onOpenTools}>工具</button>
          <button type="button" role="tab" aria-selected="false" onClick={onOpenDistribution}>分销</button>
        </div>
        <div className="rail-head">
          <strong>商品管理</strong>
          <button className="icon-button" type="button" onClick={createProduct} title="新建商品"><Plus size={17} /></button>
        </div>
        <div className="rail-actions">
          <button type="button" onClick={() => void onRefresh()}><RefreshCw size={15} />刷新</button>
          <button type="button" onClick={() => void onLogout()}><LogOut size={15} />退出</button>
        </div>
        <div className="post-list product-list">
          {products.map((product) => (
            <button key={product.id} type="button" className={product.id === activeProduct?.id ? "active" : ""} onClick={() => setActiveId(product.id)}>
              <span>{product.title}</span>
              <small>{product.status === "published" ? "已发布" : "草稿"} · {formatMoney(product.priceCents, product.currency)}</small>
            </button>
          ))}
        </div>
      </aside>

      <section className="editor-pane product-editor-pane">
        {activeProduct ? (
          <>
            <header className="editor-topbar"><div><strong>{activeProduct.title}</strong><span>/market/{activeProduct.slug}</span></div></header>
            <div className="editor-workspace product-workspace">
              <div className="product-form-grid">
                <label className="title-field product-title-field"><span>商品名称</span><input value={activeProduct.title} onChange={(event) => patchProduct({ title: event.target.value })} /></label>
                <label><span>分类</span><select value={activeProduct.category} onChange={(event) => patchProduct({ category: event.target.value })}><option value="service">服务</option><option value="digital">数字内容</option><option value="software">软件工具</option><option value="other">其它</option></select></label>
                <label><span>价格</span><input type="number" min="0" step="0.01" value={formatPriceInput(activeProduct.priceCents)} onChange={(event) => patchProduct({ priceCents: priceToCents(event.target.value) })} /></label>
                <label><span>分销佣金</span><input type="number" min="0" step="0.01" value={formatPriceInput(activeProduct.commissionCents)} onChange={(event) => patchProduct({ commissionCents: priceToCents(event.target.value) })} /><small>每笔确认成交订单的佣金</small></label>
                <label><span>划线价（可选）</span><input type="number" min="0" step="0.01" value={activeProduct.compareAtCents === null ? "" : formatPriceInput(activeProduct.compareAtCents)} onChange={(event) => patchProduct({ compareAtCents: event.target.value ? priceToCents(event.target.value) : null })} /></label>
                <label><span>币种</span><select value={activeProduct.currency} onChange={(event) => patchProduct({ currency: event.target.value })}><option value="CNY">CNY</option><option value="USD">USD</option></select></label>
                <label><span>库存</span><input type="number" min="-1" step="1" value={activeProduct.stock} onChange={(event) => patchProduct({ stock: Number(event.target.value) || 0 })} /><small>-1 表示不限量</small></label>
                <label><span>已售出</span><input type="number" min="0" step="1" value={activeProduct.soldCount} onChange={(event) => patchProduct({ soldCount: Number(event.target.value) || 0 })} /><small>商城展示的累计销量</small></label>
                <label><span>排序</span><input type="number" value={activeProduct.sortOrder} onChange={(event) => patchProduct({ sortOrder: Number(event.target.value) || 0 })} /></label>
                <label><span>发布状态</span><select value={activeProduct.status} onChange={(event) => patchProduct({ status: event.target.value as AdminProduct["status"] })}><option value="draft">草稿</option><option value="published">公开发布</option></select></label>
              </div>
              <label className="wide-field"><span>一句话简介</span><input maxLength={500} value={activeProduct.summary} onChange={(event) => patchProduct({ summary: event.target.value })} /></label>
              <div className="product-cover-row">
                <div className="product-cover-preview">{activeProduct.coverUrl ? <img src={activeProduct.coverUrl} alt="商品封面" /> : <Package size={30} />}</div>
                <div><strong>商品封面</strong><p>上传后的图片存入现有 R2 存储。</p><button type="button" onClick={() => coverInputRef.current?.click()}><ImagePlus size={15} />上传封面</button><input ref={coverInputRef} className="hidden-input" type="file" accept="image/*" onChange={(event) => { void uploadCover(event.target.files); event.target.value = ""; }} /></div>
              </div>
              <label className="wide-field"><span>商品详情</span><textarea rows={12} maxLength={12000} value={activeProduct.description} onChange={(event) => patchProduct({ description: event.target.value })} /></label>
            </div>
            <div className="toolbar product-toolbar"><span className="product-status-note">{activeProduct.status === "published" ? "公开页可见" : "仅后台可见"}</span><span className="toolbar-fill" /><button className="danger-button" type="button" onClick={() => void deleteProduct()}><Trash2 size={15} />删除</button><button className="primary" type="button" onClick={() => void saveProduct()}><Save size={15} />保存</button></div>
          </>
        ) : <div className="empty-state">暂无商品，点击左上角加号创建第一个商品。</div>}
      </section>
      {toast && <div className="toast">{toast.text}</div>}
    </main>
  );
}

function defaultProductPayload(): Omit<AdminProduct, "id" | "slug" | "createdAt" | "updatedAt"> {
  return { title: "未命名商品", summary: "请填写商品简介", description: "请填写商品详情", category: "service", priceCents: 0, commissionCents: 0, compareAtCents: null, currency: "CNY", stock: -1, soldCount: 0, coverUrl: null, status: "draft", sortOrder: 0 };
}

function ToolWorkspace({
  tools,
  setTools,
  onOpenPosts,
  onOpenProducts,
  onOpenDistribution,
  onRefresh,
  onLogout,
  showToast,
  toast
}: {
  tools: AdminTool[];
  setTools: (next: AdminTool[] | ((items: AdminTool[]) => AdminTool[])) => void;
  onOpenPosts: () => void;
  onOpenProducts: () => void;
  onOpenDistribution: () => void;
  onRefresh: () => Promise<void>;
  onLogout: () => Promise<void>;
  showToast: (text: string) => void;
  toast: Toast | null;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const activeTool = useMemo(() => tools.find((tool) => tool.id === activeId) ?? tools[0], [tools, activeId]);

  useEffect(() => {
    setActiveId((current) => current ?? tools[0]?.id ?? null);
  }, [tools]);

  function patchTool(patch: Partial<AdminTool>) {
    if (!activeTool) return;
    setTools((items) => items.map((item) => item.id === activeTool.id ? { ...item, ...patch } : item));
  }

  async function createTool() {
    const response = await fetch("/api/admin/tools", { method: "POST", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify(defaultToolPayload()) });
    if (!response.ok) return showToast("创建工具失败");
    const created = await response.json() as AdminTool;
    setTools((items) => [created, ...items]);
    setActiveId(created.id);
    showToast("工具草稿已创建");
  }

  async function saveTool() {
    if (!activeTool) return;
    const response = await fetch(`/api/admin/tools/${activeTool.id}`, { method: "PUT", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify(toolPayload(activeTool)) });
    if (!response.ok) return showToast("保存失败，请检查工具信息");
    const saved = await response.json() as AdminTool;
    setTools((items) => items.map((item) => item.id === saved.id ? saved : item));
    showToast(saved.status === "published" ? "工具已发布" : "工具草稿已保存");
  }

  async function deleteTool() {
    if (!activeTool || !confirm(`确认删除工具《${activeTool.title}》？`)) return;
    const response = await fetch(`/api/admin/tools/${activeTool.id}`, { method: "DELETE", credentials: "include" });
    if (!response.ok) return showToast("删除失败");
    setTools((items) => items.filter((item) => item.id !== activeTool.id));
    setActiveId(null);
    showToast("工具已删除");
  }

  async function uploadCover(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return showToast("封面只能使用图片文件");
    try {
      const uploaded = await uploadFile(file);
      patchTool({ coverUrl: uploaded.url });
      showToast("封面已上传，保存工具后生效");
    } catch {
      showToast("封面上传失败");
    }
  }

  return (
    <main className="admin-shell">
      <aside className="post-rail">
        <div className="workspace-tabs" role="tablist" aria-label="后台工作区">
          <button type="button" role="tab" aria-selected="false" onClick={onOpenPosts}>文章</button>
          <button type="button" role="tab" aria-selected="false" onClick={onOpenProducts}>商品</button>
          <button className="active" type="button" role="tab" aria-selected="true">工具</button>
          <button type="button" role="tab" aria-selected="false" onClick={onOpenDistribution}>分销</button>
        </div>
        <div className="rail-head"><strong>工具管理</strong><button className="icon-button" type="button" onClick={createTool} title="新建工具"><Plus size={17} /></button></div>
        <div className="rail-actions"><button type="button" onClick={() => void onRefresh()}><RefreshCw size={15} />刷新</button><button type="button" onClick={() => void onLogout()}><LogOut size={15} />退出</button></div>
        <div className="post-list product-list">{tools.map((tool) => <button key={tool.id} type="button" className={tool.id === activeTool?.id ? "active" : ""} onClick={() => setActiveId(tool.id)}><span>{tool.title}</span><small>{tool.status === "published" ? "已发布" : "草稿"} · {tool.category}</small></button>)}</div>
      </aside>
      <section className="editor-pane product-editor-pane">
        {activeTool ? <>
          <header className="editor-topbar"><div><strong>{activeTool.title}</strong><span>/tools/{activeTool.slug}</span></div></header>
          <div className="editor-workspace product-workspace">
            <div className="product-form-grid">
              <label className="title-field product-title-field"><span>工具名称</span><input value={activeTool.title} onChange={(event) => patchTool({ title: event.target.value })} /></label>
              <label><span>分类</span><select value={activeTool.category} onChange={(event) => patchTool({ category: event.target.value })}><option value="writing">写作</option><option value="design">设计</option><option value="productivity">效率</option><option value="other">其它</option></select></label>
              <label><span>排序</span><input type="number" value={activeTool.sortOrder} onChange={(event) => patchTool({ sortOrder: Number(event.target.value) || 0 })} /></label>
              <label><span>发布状态</span><select value={activeTool.status} onChange={(event) => patchTool({ status: event.target.value as AdminTool["status"] })}><option value="draft">草稿</option><option value="published">公开发布</option></select></label>
            </div>
            <label className="wide-field"><span>工具网址</span><input type="url" maxLength={2000} value={activeTool.url} onChange={(event) => patchTool({ url: event.target.value })} placeholder="https://" /></label>
            <label className="wide-field"><span>一句话简介</span><input maxLength={500} value={activeTool.summary} onChange={(event) => patchTool({ summary: event.target.value })} /></label>
            <div className="product-cover-row"><div className="product-cover-preview">{activeTool.coverUrl ? <img src={activeTool.coverUrl} alt="工具封面" /> : <Package size={30} />}</div><div><strong>工具封面</strong><p>可选，建议使用横向图片。</p><button type="button" onClick={() => coverInputRef.current?.click()}><ImagePlus size={15} />上传封面</button><input ref={coverInputRef} className="hidden-input" type="file" accept="image/*" onChange={(event) => { void uploadCover(event.target.files); event.target.value = ""; }} /></div></div>
            <label className="wide-field"><span>工具介绍</span><textarea rows={12} maxLength={12000} value={activeTool.description} onChange={(event) => patchTool({ description: event.target.value })} /></label>
          </div>
          <div className="toolbar product-toolbar"><span className="product-status-note">{activeTool.status === "published" ? "公开页可见" : "仅后台可见"}</span><span className="toolbar-fill" /><button className="danger-button" type="button" onClick={() => void deleteTool()}><Trash2 size={15} />删除</button><button className="primary" type="button" onClick={() => void saveTool()}><Save size={15} />保存</button></div>
        </> : <div className="empty-state">暂无工具，点击左上角加号创建第一个工具。</div>}
      </section>
      {toast && <div className="toast">{toast.text}</div>}
    </main>
  );
}

function defaultToolPayload(): Omit<AdminTool, "id" | "slug" | "createdAt" | "updatedAt"> {
  return { title: "未命名工具", summary: "请填写工具简介", description: "请填写工具介绍", category: "other", url: "https://", coverUrl: null, status: "draft", sortOrder: 0 };
}

function toolPayload(tool: AdminTool) {
  const { id: _id, slug: _slug, createdAt: _createdAt, updatedAt: _updatedAt, ...payload } = tool;
  return payload;
}

function DistributionWorkspace({
  affiliates,
  orders,
  setAffiliates,
  setOrders,
  onOpenPosts,
  onOpenProducts,
  onOpenTools,
  onRefresh,
  onLogout,
  showToast,
  toast
}: {
  affiliates: AdminAffiliate[];
  orders: AdminAffiliateOrder[];
  setAffiliates: (next: AdminAffiliate[] | ((items: AdminAffiliate[]) => AdminAffiliate[])) => void;
  setOrders: (next: AdminAffiliateOrder[] | ((items: AdminAffiliateOrder[]) => AdminAffiliateOrder[])) => void;
  onOpenPosts: () => void;
  onOpenProducts: () => void;
  onOpenTools: () => void;
  onRefresh: () => Promise<void>;
  onLogout: () => Promise<void>;
  showToast: (text: string) => void;
  toast: Toast | null;
}) {
  const [activeAffiliateId, setActiveAffiliateId] = useState<string | null>(null);
  const activeAffiliate = affiliates.find((affiliate) => affiliate.id === activeAffiliateId) ?? null;
  const visibleOrders = activeAffiliate
    ? orders.filter((order) => order.affiliateWechatId === activeAffiliate.wechatId)
    : orders;

  async function updateAffiliateStatus(affiliate: AdminAffiliate) {
    const status = affiliate.status === "active" ? "disabled" : "active";
    const response = await fetch(`/api/admin/affiliates/${affiliate.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ status })
    });
    if (!response.ok) return showToast("推广者状态更新失败");
    setAffiliates((items) => items.map((item) => item.id === affiliate.id ? { ...item, status } : item));
    showToast(status === "active" ? "推广资格已恢复" : "推广资格已停用");
  }

  async function resetAffiliatePassword(affiliate: AdminAffiliate) {
    const response = await fetch(`/api/admin/affiliates/${affiliate.id}/reset-password`, { method: "POST", credentials: "include" });
    if (!response.ok) return showToast("查询密码重置失败");
    const { queryPassword } = await response.json() as { queryPassword: string };
    await navigator.clipboard.writeText(queryPassword);
    showToast(`新查询密码 ${queryPassword} 已复制`);
  }

  async function updateOrder(order: AdminAffiliateOrder, patch: Partial<Pick<AdminAffiliateOrder, "orderStatus" | "commissionStatus">>) {
    const next = { ...order, ...patch };
    if (next.orderStatus !== "completed") next.commissionStatus = "not_due";
    if (next.orderStatus === "completed" && next.commissionStatus === "not_due") next.commissionStatus = "pending";
    const response = await fetch(`/api/admin/affiliate-orders/${order.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ orderStatus: next.orderStatus, commissionStatus: next.commissionStatus })
    });
    if (!response.ok) return showToast("订单状态更新失败");
    const saved = await response.json() as AdminAffiliateOrder;
    setOrders((items) => items.map((item) => item.id === saved.id ? saved : item));
    showToast("订单状态已更新");
  }

  const completedTotal = orders.filter((order) => order.orderStatus === "completed").reduce((sum, order) => sum + order.priceCents, 0);
  const pendingCommission = orders.filter((order) => order.commissionStatus === "pending").reduce((sum, order) => sum + order.commissionCents, 0);

  return (
    <main className="admin-shell distribution-shell">
      <aside className="post-rail">
        <div className="workspace-tabs" role="tablist" aria-label="后台工作区">
          <button type="button" role="tab" aria-selected="false" onClick={onOpenPosts}>文章</button>
          <button type="button" role="tab" aria-selected="false" onClick={onOpenProducts}>商品</button>
          <button type="button" role="tab" aria-selected="false" onClick={onOpenTools}>工具</button>
          <button className="active" type="button" role="tab" aria-selected="true">分销</button>
        </div>
        <div className="rail-head"><strong>推广者</strong><span>{affiliates.length} 人</span></div>
        <div className="rail-actions"><button type="button" onClick={() => void onRefresh()}><RefreshCw size={15} />刷新</button><button type="button" onClick={() => void onLogout()}><LogOut size={15} />退出</button></div>
        <div className="post-list affiliate-list">
          <button type="button" className={activeAffiliateId === null ? "active" : ""} onClick={() => setActiveAffiliateId(null)}><span>全部订单</span><small>{orders.length} 个订单</small></button>
          {affiliates.map((affiliate) => <button key={affiliate.id} type="button" className={affiliate.id === activeAffiliateId ? "active" : ""} onClick={() => setActiveAffiliateId(affiliate.id)}><span>{affiliate.wechatId}</span><small>{affiliate.totalClicks} 点击 · {affiliate.orderCount} 订单</small></button>)}
        </div>
      </aside>
      <section className="editor-pane distribution-pane">
        <header className="editor-topbar"><div><strong>分销管理</strong><span>订单确认与线下佣金结算</span></div></header>
        <div className="distribution-workspace">
          <div className="distribution-summary"><div><span>推广者</span><strong>{affiliates.length}</strong></div><div><span>成交金额</span><strong>{formatMoney(completedTotal, "CNY")}</strong></div><div><span>待支付佣金</span><strong>{formatMoney(pendingCommission, "CNY")}</strong></div><div><span>待联系订单</span><strong>{orders.filter((order) => order.orderStatus === "pending").length}</strong></div></div>
          {activeAffiliate && <section className="affiliate-admin-detail"><div><span>微信号</span><strong>{activeAffiliate.wechatId}</strong></div><div><span>总点击 / 独立访客</span><strong>{activeAffiliate.totalClicks} / {activeAffiliate.uniqueClicks}</strong></div><div className="affiliate-admin-actions"><button type="button" onClick={() => void resetAffiliatePassword(activeAffiliate)}>重置密码</button><button className={activeAffiliate.status === "active" ? "danger-button" : "primary"} type="button" onClick={() => void updateAffiliateStatus(activeAffiliate)}>{activeAffiliate.status === "active" ? "停用推广资格" : "恢复推广资格"}</button></div></section>}
          <section className="distribution-orders"><div className="distribution-section-head"><h2>{activeAffiliate ? `${activeAffiliate.wechatId} 的订单` : "全部分销订单"}</h2><span>{visibleOrders.length} 条</span></div>
            <div className="distribution-table-wrap"><table><thead><tr><th>订单号 / 时间</th><th>推广者</th><th>商品</th><th>价格 / 佣金</th><th>订单状态</th><th>佣金状态</th></tr></thead><tbody>{visibleOrders.map((order) => <tr key={order.id}><td><strong>{order.orderCode}</strong><small>{formatDate(order.createdAt)}</small></td><td>{order.affiliateWechatId}</td><td>{order.productTitle}</td><td><strong>{formatMoney(order.priceCents, order.currency)}</strong><small>佣金 {formatMoney(order.commissionCents, order.currency)}</small></td><td><select value={order.orderStatus} onChange={(event) => void updateOrder(order, { orderStatus: event.target.value as AdminAffiliateOrder["orderStatus"] })}><option value="pending">待联系</option><option value="completed">已成交</option><option value="canceled">已取消</option></select></td><td><select value={order.commissionStatus} disabled={order.orderStatus !== "completed"} onChange={(event) => void updateOrder(order, { commissionStatus: event.target.value as AdminAffiliateOrder["commissionStatus"] })}><option value="not_due">无需结算</option><option value="pending">待支付</option><option value="paid">已支付</option></select></td></tr>)}</tbody></table>{visibleOrders.length === 0 && <p className="empty-table">暂无订单</p>}</div>
          </section>
        </div>
      </section>
      {toast && <div className="toast">{toast.text}</div>}
    </main>
  );
}

function productPayload(product: AdminProduct) {
  const { id: _id, slug: _slug, createdAt: _createdAt, updatedAt: _updatedAt, ...payload } = product;
  return payload;
}

function priceToCents(value: string): number {
  const price = Number(value);
  return Number.isFinite(price) && price >= 0 ? Math.round(price * 100) : 0;
}

function formatPriceInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: currency || "CNY", minimumFractionDigits: 2 }).format(cents / 100);
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
    return `![${escapeMarkdown(img.alt || "图片")}](${img.src})`;
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
