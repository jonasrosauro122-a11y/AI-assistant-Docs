import React, { useEffect, useMemo, useState } from 'react';
import { supabase, isSupabaseConfigured } from './lib/supabaseClient.js';
import { callSpine, isSpineConfigured } from './lib/spineClient.js';
import { chunkText, isMarkdownFile, readTextFile, sanitizeFileName } from './lib/chunking.js';
import { writeActivity } from './lib/activity.js';
import { LAVA_EMPLOYEES } from './data/Lava_Employees_Merged.js';

const B = {
  red: '#e73835',
  darkBlue: '#24242d',
  teal: '#145365',
  white: '#ffffff',
  black: '#1B120B'
};

const STORAGE_BUCKET = import.meta.env.VITE_STORAGE_BUCKET || 'training-docs';
const ENABLE_LOCAL_CHUNK_FALLBACK = import.meta.env.VITE_ENABLE_LOCAL_CHUNK_FALLBACK === 'true';

const DEPARTMENTS = [
  'Training',
  'Customer Success',
  'Personal Lines',
  'Commercial Lines',
  'AMS Systems',
  'Farmers',
  'Operations',
  'Admin'
];

const SUGGESTED_QUESTIONS = [
  'What should I do if I cannot access AMS360?',
  'When should a VA escalate to a Trainer or TL?',
  'Can a VA answer coverage questions?',
  'What is the attendance policy?',
  'What is the process for Farmers portal access?'
];

function getEmployeeName(employee) {
  return employee?.full_name || employee?.name || employee?.display_name || employee?.email || 'Lava User';
}

function getEmployeeEmail(employee) {
  return employee?.email || employee?.work_email || employee?.Email || '';
}

function getEmployeeDepartment(employee) {
  return employee?.department || employee?.Department || employee?.team || employee?.Team || 'Training';
}

function roleText(employee, grants) {
  const grantText = Array.isArray(grants) ? grants.map((g) => JSON.stringify(g)).join(' ') : '';
  return `${employee?.role || ''} ${employee?.title || ''} ${employee?.position || ''} ${grantText}`.toLowerCase();
}

function hasElevatedAccess(employee, grants) {
  const text = roleText(employee, grants);
  return /admin|trainer|training|team lead|teamlead|tl|director|manager|owner/.test(text);
}

function canUpload(employee, grants) {
  const text = roleText(employee, grants);
  return /admin|trainer|training|director|manager|owner/.test(text);
}

function getFileType(file) {
  const name = (file?.name || '').toLowerCase();
  if (name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.md') || name.endsWith('.markdown')) return 'markdown';
  if (file?.type === 'text/plain') return 'markdown';
  return 'unknown';
}

function confidenceLabel(value) {
  if (!value) return 'Medium';
  const normalized = String(value).toLowerCase();
  if (normalized.includes('high')) return 'High';
  if (normalized.includes('low')) return 'Low';
  return 'Medium';
}

function safeExcerpt(text, max = 220) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max)}...`;
}

function keywordTokens(question) {
  return String(question || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 3)
    .filter((token) => !['what', 'when', 'where', 'should', 'could', 'would', 'please', 'about', 'with', 'from', 'that', 'this'].includes(token))
    .slice(0, 6);
}

function ScreenShell({ children }) {
  return (
    <div style={styles.pageShell}>
      <div style={styles.bgOrbOne} />
      <div style={styles.bgOrbTwo} />
      {children}
    </div>
  );
}

function Card({ children, style }) {
  return <div style={{ ...styles.card, ...(style || {}) }}>{children}</div>;
}

function Button({ children, onClick, kind = 'primary', disabled, type = 'button', style }) {
  const base = kind === 'ghost' ? styles.buttonGhost : kind === 'light' ? styles.buttonLight : kind === 'danger' ? styles.buttonDanger : styles.buttonPrimary;
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={{ ...base, opacity: disabled ? 0.55 : 1, cursor: disabled ? 'not-allowed' : 'pointer', ...(style || {}) }}>
      {children}
    </button>
  );
}

function TextInput(props) {
  return <input {...props} style={{ ...styles.input, ...(props.style || {}) }} />;
}

function TextArea(props) {
  return <textarea {...props} style={{ ...styles.textarea, ...(props.style || {}) }} />;
}

function Select(props) {
  return <select {...props} style={{ ...styles.input, ...(props.style || {}) }} />;
}

function Pill({ children, tone = 'teal' }) {
  const bg = tone === 'red' ? 'rgba(231, 56, 53, .12)' : tone === 'dark' ? 'rgba(36, 36, 45, .12)' : 'rgba(20, 83, 101, .12)';
  const color = tone === 'red' ? B.red : tone === 'dark' ? B.darkBlue : B.teal;
  return <span style={{ ...styles.pill, background: bg, color }}>{children}</span>;
}

function Header({ employee, grants, activeScreen, setActiveScreen, onLogout }) {
  const elevated = hasElevatedAccess(employee, grants);
  const uploader = canUpload(employee, grants);
  const tabs = [
    ['chat', 'Ask Docs'],
    ['library', 'Library'],
    ...(uploader ? [['upload', 'Upload']] : []),
    ...(elevated ? [['audit', 'Audit']] : [])
  ];

  return (
    <div style={styles.headerWrap}>
      <div>
        <div style={styles.kicker}>Lava Training Knowledge Search</div>
        <h1 style={styles.logoTitle}>AI Assistant over Docs</h1>
      </div>
      <div style={styles.headerRight}>
        <div style={styles.tabRow}>
          {tabs.map(([key, label]) => (
            <button key={key} onClick={() => setActiveScreen(key)} style={activeScreen === key ? styles.tabActive : styles.tab}>
              {label}
            </button>
          ))}
        </div>
        <div style={styles.userBox}>
          <strong>{getEmployeeName(employee)}</strong>
          <span>{getEmployeeDepartment(employee)}</span>
        </div>
        <Button kind="ghost" onClick={onLogout}>Logout</Button>
      </div>
    </div>
  );
}

function LoginScreen({ onDemoLogin }) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('');
  const [sending, setSending] = useState(false);

  async function sendMagicLink(event) {
    event.preventDefault();
    if (!email.trim()) return;

    if (!isSupabaseConfigured || !supabase) {
      setStatus('Supabase is not configured yet. Add your .env values first.');
      return;
    }

    setSending(true);
    setStatus('');
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: window.location.origin
      }
    });
    setSending(false);
    setStatus(error ? error.message : 'Magic link sent. Please check your email.');
  }

  return (
    <ScreenShell>
      <div style={styles.loginGrid}>
        <Card style={styles.heroCard}>
          <div style={styles.kicker}>Secure VA-Facing Knowledge Search</div>
          <h1 style={styles.heroTitle}>Ask Lava policies, SOPs, and training docs with cited answers.</h1>
          <p style={styles.heroText}>
            Built for VAs, Trainers, TLs, and Admins. Answers stay scoped to approved documents and department access.
          </p>
          <div style={styles.featureGrid}>
            <Pill>Department RLS</Pill>
            <Pill tone="red">Clickable citations</Pill>
            <Pill tone="dark">Spine AI proxy</Pill>
          </div>
        </Card>

        <Card>
          <h2 style={styles.sectionTitle}>Sign in with Lava email</h2>
          <p style={styles.muted}>Use magic link authentication. Approved employees only.</p>
          <form onSubmit={sendMagicLink} style={styles.formStack}>
            <label style={styles.label}>Email address</label>
            <TextInput value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@lavatraining.com" type="email" />
            <Button type="submit" disabled={sending}>{sending ? 'Sending...' : 'Send Magic Link'}</Button>
          </form>
          {status && <p style={styles.notice}>{status}</p>}
          {!isSupabaseConfigured && (
            <div style={styles.devBox}>
              <strong>Local preview mode</strong>
              <p>Supabase is not connected yet. You can open the demo UI while setting up the database.</p>
              <Button kind="light" onClick={onDemoLogin}>Open Demo UI</Button>
            </div>
          )}
        </Card>
      </div>
    </ScreenShell>
  );
}

function ChatScreen({ employee, grants, session }) {
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const department = getEmployeeDepartment(employee);
  const elevated = hasElevatedAccess(employee, grants);

  async function askQuestion(inputQuestion) {
    const trimmed = String(inputQuestion || question).trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setNotice('');
    setQuestion('');

    const userMessage = { role: 'user', content: trimmed, created_at: new Date().toISOString() };
    setMessages((previous) => [...previous, userMessage]);

    try {
      await writeActivity(supabase, {
        actor: employee,
        action: 'docs.queried',
        targetType: 'doc_chunks',
        metadata: { question: trimmed, department }
      });

      let answerPayload;
      if (isSpineConfigured) {
        const data = await callSpine('docs.answer', {
          question: trimmed,
          employee_id: employee?.id,
          employee_name: getEmployeeName(employee),
          department,
          elevated_access: elevated
        }, session?.access_token);
        answerPayload = normalizeAnswerPayload(data);
      } else {
        answerPayload = await localFallbackSearch(trimmed, employee, grants);
      }

      if (!answerPayload.citations?.length) {
        answerPayload = {
          answer: 'I could not find an approved Lava document for this answer. Please escalate this to your Trainer or Team Lead.',
          confidence: 'Low',
          citations: []
        };
      }

      const assistantMessage = {
        role: 'assistant',
        content: answerPayload.answer,
        confidence: answerPayload.confidence || 'Medium',
        citations: answerPayload.citations || [],
        created_at: new Date().toISOString()
      };
      setMessages((previous) => [...previous, assistantMessage]);

      if (answerPayload.citations?.length) {
        await writeActivity(supabase, {
          actor: employee,
          action: 'docs.cited',
          targetType: 'doc_chunks',
          metadata: {
            question: trimmed,
            citations: answerPayload.citations.map((c) => ({ doc_id: c.doc_id, title: c.title, confidence: c.confidence }))
          }
        });
      }
    } catch (error) {
      console.error(error);
      setMessages((previous) => [
        ...previous,
        {
          role: 'assistant',
          content: 'I could not complete the document search. Please check the Supabase/spine connection, or escalate this to your Trainer or Team Lead.',
          confidence: 'Low',
          citations: [],
          created_at: new Date().toISOString()
        }
      ]);
      setNotice(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function localFallbackSearch(trimmedQuestion, employeeRecord, grantRecords) {
    if (!supabase) {
      return {
        answer: 'Supabase and the spine AI proxy are not configured yet. Connect them before production use.',
        confidence: 'Low',
        citations: []
      };
    }

    const tokens = keywordTokens(trimmedQuestion);
    if (!tokens.length) {
      return { answer: 'Please ask a more specific question so I can search the approved Lava documents.', confidence: 'Low', citations: [] };
    }

    let query = supabase
      .from('doc_chunks')
      .select('id, doc_id, chunk_text, department, docs(id, title, file_path, department, status)')
      .limit(8);

    if (!hasElevatedAccess(employeeRecord, grantRecords)) {
      query = query.eq('department', getEmployeeDepartment(employeeRecord));
    }

    query = query.or(tokens.map((token) => `chunk_text.ilike.%${token}%`).join(','));
    const { data, error } = await query;

    if (error) throw error;
    if (!data?.length) {
      return { answer: 'I could not find an approved Lava document for this answer. Please escalate this to your Trainer or Team Lead.', confidence: 'Low', citations: [] };
    }

    return {
      answer: 'I found possible matching Lava document sections. The AI response layer is not connected yet, so please review the cited excerpts below and confirm with a Trainer or Team Lead before taking action.',
      confidence: 'Low',
      citations: data.map((chunk) => ({
        chunk_id: chunk.id,
        doc_id: chunk.doc_id,
        title: chunk.docs?.title || 'Lava Document',
        excerpt: safeExcerpt(chunk.chunk_text),
        confidence: 'Low',
        url: getDocumentPublicUrl(chunk.docs?.file_path)
      }))
    };
  }

  function normalizeAnswerPayload(data) {
    const payload = data?.payload || data?.data || data;
    return {
      answer: payload?.answer || payload?.message || 'I could not find a clear answer in the approved Lava documents.',
      confidence: confidenceLabel(payload?.confidence),
      citations: Array.isArray(payload?.citations) ? payload.citations.map((citation) => ({
        chunk_id: citation.chunk_id || citation.id,
        doc_id: citation.doc_id,
        title: citation.title || citation.doc_title || 'Lava Document',
        excerpt: citation.excerpt || citation.chunk_text || citation.section || '',
        confidence: confidenceLabel(citation.confidence),
        url: citation.url || citation.file_url || getDocumentPublicUrl(citation.file_path)
      })) : []
    };
  }

  return (
    <div style={styles.mainGrid}>
      <Card style={styles.chatCard}>
        <div style={styles.chatHeader}>
          <div>
            <h2 style={styles.sectionTitle}>Ask Lava Docs</h2>
            <p style={styles.muted}>Answers must come from approved uploaded documents.</p>
          </div>
          <Pill>{department}</Pill>
        </div>

        <div style={styles.suggestionsRow}>
          {SUGGESTED_QUESTIONS.map((item) => (
            <button key={item} onClick={() => askQuestion(item)} style={styles.suggestionChip} disabled={loading}>{item}</button>
          ))}
        </div>

        <div style={styles.messageList}>
          {messages.length === 0 && (
            <div style={styles.emptyState}>
              <strong>Start with one training question.</strong>
              <span>The assistant will search only Lava-approved docs and return citations.</span>
            </div>
          )}
          {messages.map((message, index) => (
            <div key={`${message.created_at}-${index}`} style={message.role === 'user' ? styles.userMessage : styles.assistantMessage}>
              <div style={styles.messageRole}>{message.role === 'user' ? 'You' : 'Lava Docs AI'}</div>
              <p style={styles.messageText}>{message.content}</p>
              {message.role === 'assistant' && (
                <div style={styles.answerMeta}>
                  <Pill tone={message.confidence === 'Low' ? 'red' : 'teal'}>Confidence: {message.confidence}</Pill>
                </div>
              )}
              {message.citations?.length > 0 && (
                <div style={styles.citationList}>
                  <strong>Sources</strong>
                  {message.citations.map((citation, citationIndex) => (
                    <div key={`${citation.doc_id}-${citationIndex}`} style={styles.citationCard}>
                      <div style={styles.citationTopline}>
                        {citation.url ? (
                          <a href={citation.url} target="_blank" rel="noreferrer" style={styles.sourceLink}>{citation.title}</a>
                        ) : (
                          <span style={styles.sourceLinkAsText}>{citation.title}</span>
                        )}
                        <Pill tone={citation.confidence === 'Low' ? 'red' : 'teal'}>{confidenceLabel(citation.confidence)}</Pill>
                      </div>
                      {citation.excerpt && <p style={styles.excerpt}>{safeExcerpt(citation.excerpt)}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {loading && <div style={styles.loadingBubble}>Searching approved Lava documents...</div>}
        </div>

        <form onSubmit={(event) => { event.preventDefault(); askQuestion(question); }} style={styles.askForm}>
          <TextInput value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about Lava SOPs, policies, or training process..." />
          <Button type="submit" disabled={loading}>{loading ? 'Searching' : 'Ask'}</Button>
        </form>
        {notice && <p style={styles.notice}>{notice}</p>}
      </Card>

      <Card style={styles.sideCard}>
        <h3 style={styles.smallTitle}>AI Guardrails</h3>
        <ul style={styles.cleanList}>
          <li>Answers only from uploaded Lava documents.</li>
          <li>Every answer should include citations.</li>
          <li>Coverage, legal, claims, and licensed-agent decisions should be escalated.</li>
          <li>Department RLS controls what each user can search.</li>
        </ul>
        <div style={styles.devBox}>
          <strong>Connection status</strong>
          <p>Supabase: {isSupabaseConfigured ? 'Connected' : 'Not configured'}</p>
          <p>Spine proxy: {isSpineConfigured ? 'Configured' : 'Not configured'}</p>
        </div>
      </Card>
    </div>
  );
}

function UploadScreen({ employee, session, refreshSignal, setRefreshSignal }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [department, setDepartment] = useState(getEmployeeDepartment(employee));
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleUpload(event) {
    event.preventDefault();
    if (!supabase) {
      setStatus('Supabase is not configured yet.');
      return;
    }
    if (!file || !title.trim()) {
      setStatus('Please add a title and select a PDF or Markdown file.');
      return;
    }

    const fileType = getFileType(file);
    if (!['pdf', 'markdown'].includes(fileType)) {
      setStatus('Only PDF and Markdown files are supported.');
      return;
    }

    setBusy(true);
    setStatus('Uploading document...');

    try {
      const safeName = sanitizeFileName(file.name);
      const path = `${department}/${Date.now()}-${safeName}`;
      const uploadResult = await supabase.storage.from(STORAGE_BUCKET).upload(path, file, { upsert: false });
      if (uploadResult.error) throw uploadResult.error;

      const docInsert = await supabase
        .from('docs')
        .insert({
          title: title.trim(),
          description: description.trim(),
          file_path: path,
          file_type: fileType,
          department,
          uploaded_by: employee?.id || null,
          status: 'indexing'
        })
        .select('*')
        .single();

      if (docInsert.error) throw docInsert.error;
      const doc = docInsert.data;

      await writeActivity(supabase, {
        actor: employee,
        action: 'docs.uploaded',
        targetType: 'docs',
        targetId: doc.id,
        metadata: { title: doc.title, department, file_type: fileType, file_path: path }
      });

      setStatus('Indexing document through the spine...');
      let indexed = false;

      if (isSpineConfigured) {
        await callSpine('docs.index', {
          doc_id: doc.id,
          title: doc.title,
          description: doc.description,
          file_path: path,
          file_type: fileType,
          department,
          storage_bucket: STORAGE_BUCKET
        }, session?.access_token);
        indexed = true;
      } else if (ENABLE_LOCAL_CHUNK_FALLBACK && isMarkdownFile(file)) {
        const text = await readTextFile(file);
        const chunks = chunkText(text).map((chunk) => ({
          doc_id: doc.id,
          chunk_text: chunk.chunk_text,
          chunk_index: chunk.chunk_index,
          department
        }));
        if (chunks.length) {
          const chunksInsert = await supabase.from('doc_chunks').insert(chunks);
          if (chunksInsert.error) throw chunksInsert.error;
          indexed = true;
        }
      }

      await supabase.from('docs').update({ status: indexed ? 'indexed' : 'failed', updated_at: new Date().toISOString() }).eq('id', doc.id);

      await writeActivity(supabase, {
        actor: employee,
        action: indexed ? 'docs.indexed' : 'docs.index_failed',
        targetType: 'docs',
        targetId: doc.id,
        metadata: { title: doc.title, department, indexed_with: isSpineConfigured ? 'spine' : 'local_markdown_fallback' }
      });

      setStatus(indexed ? 'Document uploaded and indexed.' : 'Document uploaded, but indexing needs the spine proxy.');
      setTitle('');
      setDescription('');
      setFile(null);
      setRefreshSignal(refreshSignal + 1);
    } catch (error) {
      console.error(error);
      setStatus(error.message || 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div style={styles.chatHeader}>
        <div>
          <h2 style={styles.sectionTitle}>Upload SOP / Policy</h2>
          <p style={styles.muted}>PDF or Markdown files are saved to Supabase Storage and indexed through the spine.</p>
        </div>
        <Pill tone="red">Admin / Trainer</Pill>
      </div>

      <form onSubmit={handleUpload} style={styles.uploadGrid}>
        <div style={styles.formStack}>
          <label style={styles.label}>Document title</label>
          <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Example: Escalation Runbook" />
        </div>
        <div style={styles.formStack}>
          <label style={styles.label}>Department</label>
          <Select value={department} onChange={(e) => setDepartment(e.target.value)}>
            {DEPARTMENTS.map((item) => <option key={item} value={item}>{item}</option>)}
          </Select>
        </div>
        <div style={{ ...styles.formStack, gridColumn: '1 / -1' }}>
          <label style={styles.label}>Description</label>
          <TextArea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short description for the document library..." />
        </div>
        <div style={{ ...styles.formStack, gridColumn: '1 / -1' }}>
          <label style={styles.label}>PDF or Markdown file</label>
          <input type="file" accept=".pdf,.md,.markdown,text/plain,application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} style={styles.fileInput} />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <Button type="submit" disabled={busy}>{busy ? 'Working...' : 'Upload and Index'}</Button>
        </div>
      </form>

      {status && <p style={styles.notice}>{status}</p>}
      {!isSpineConfigured && (
        <div style={styles.devBox}>
          <strong>Spine proxy required for production indexing</strong>
          <p>PDF text extraction, embeddings, and Anthropic calls should happen through the approved spine. The browser never receives secret keys.</p>
        </div>
      )}
    </Card>
  );
}

function LibraryScreen({ employee, grants, refreshSignal }) {
  const [docs, setDocs] = useState([]);
  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const elevated = hasElevatedAccess(employee, grants);

  useEffect(() => {
    loadDocs();
  }, [refreshSignal, employee?.id]);

  async function loadDocs() {
    if (!supabase) {
      setDocs(seedDemoDocs());
      return;
    }

    setLoading(true);
    setNotice('');
    try {
      let query = supabase.from('docs').select('*').order('created_at', { ascending: false }).limit(200);
      if (!elevated) query = query.eq('department', getEmployeeDepartment(employee));
      const { data, error } = await query;
      if (error) throw error;
      setDocs(data || []);
    } catch (error) {
      console.error(error);
      setNotice(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function archiveDoc(doc) {
    if (!supabase) return;
    const { error } = await supabase.from('docs').update({ status: 'archived', updated_at: new Date().toISOString() }).eq('id', doc.id);
    if (error) {
      setNotice(error.message);
      return;
    }
    await writeActivity(supabase, {
      actor: employee,
      action: 'docs.archived',
      targetType: 'docs',
      targetId: doc.id,
      metadata: { title: doc.title, department: doc.department }
    });
    await loadDocs();
  }

  const filteredDocs = docs.filter((doc) => {
    const departmentMatch = filter === 'All' || doc.department === filter;
    const searchMatch = !search.trim() || `${doc.title} ${doc.description}`.toLowerCase().includes(search.toLowerCase());
    return departmentMatch && searchMatch;
  });

  return (
    <Card>
      <div style={styles.chatHeader}>
        <div>
          <h2 style={styles.sectionTitle}>Document Library</h2>
          <p style={styles.muted}>Uploaded SOPs, policies, and training documents.</p>
        </div>
        <Button kind="light" onClick={loadDocs}>{loading ? 'Loading...' : 'Refresh'}</Button>
      </div>

      <div style={styles.toolbar}>
        <TextInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title or description..." />
        <Select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 240 }}>
          <option value="All">All departments</option>
          {DEPARTMENTS.map((item) => <option key={item} value={item}>{item}</option>)}
        </Select>
      </div>

      {notice && <p style={styles.notice}>{notice}</p>}
      <div style={styles.docGrid}>
        {filteredDocs.map((doc) => (
          <div key={doc.id} style={styles.docCard}>
            <div style={styles.docCardTopline}>
              <Pill>{doc.department}</Pill>
              <Pill tone={doc.status === 'failed' || doc.status === 'archived' ? 'red' : 'dark'}>{doc.status || 'uploaded'}</Pill>
            </div>
            <h3 style={styles.docTitle}>{doc.title}</h3>
            <p style={styles.docDescription}>{doc.description || 'No description added.'}</p>
            <div style={styles.docActions}>
              {doc.file_path && getDocumentPublicUrl(doc.file_path) && (
                <a href={getDocumentPublicUrl(doc.file_path)} target="_blank" rel="noreferrer" style={styles.linkButton}>Open Source</a>
              )}
              {elevated && doc.status !== 'archived' && <Button kind="light" onClick={() => archiveDoc(doc)}>Archive</Button>}
            </div>
          </div>
        ))}
      </div>
      {!filteredDocs.length && <div style={styles.emptyState}>No documents found.</div>}
    </Card>
  );
}

function AuditScreen({ employee }) {
  const [items, setItems] = useState([]);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadAudit();
  }, []);

  async function loadAudit() {
    if (!supabase) {
      setItems([]);
      return;
    }
    setLoading(true);
    setNotice('');
    try {
      const { data, error } = await supabase
        .from('activity_log')
        .select('*')
        .eq('app', 'ai-docs')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      setItems(data || []);
    } catch (error) {
      console.error(error);
      setNotice(error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <div style={styles.chatHeader}>
        <div>
          <h2 style={styles.sectionTitle}>Audit & Usage</h2>
          <p style={styles.muted}>Recent uploads, queries, citations, and denied/failed events.</p>
        </div>
        <Button kind="light" onClick={loadAudit}>{loading ? 'Loading...' : 'Refresh'}</Button>
      </div>
      {notice && <p style={styles.notice}>{notice}</p>}
      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Time</th>
              <th style={styles.th}>Actor</th>
              <th style={styles.th}>Action</th>
              <th style={styles.th}>Target</th>
              <th style={styles.th}>Metadata</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td style={styles.td}>{new Date(item.created_at).toLocaleString()}</td>
                <td style={styles.td}>{item.actor_name || getEmployeeName(employee)}</td>
                <td style={styles.td}><Pill>{item.action}</Pill></td>
                <td style={styles.td}>{item.target_type || '-'} / {item.target_id || '-'}</td>
                <td style={styles.td}><code style={styles.code}>{JSON.stringify(item.metadata || {})}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && <div style={styles.emptyState}>No audit activity yet.</div>}
      </div>
    </Card>
  );
}

function getDocumentPublicUrl(filePath) {
  if (!filePath || !supabase) return '';
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(filePath);
  return data?.publicUrl || '';
}

function seedDemoDocs() {
  return [
    { id: 'demo-1', title: 'Lava Insurance VA Onboarding Guide', description: 'Starter expectations for insurance VAs.', department: 'Training', status: 'indexed' },
    { id: 'demo-2', title: 'Escalation Runbook', description: 'When to escalate to Trainer, TL, AM, or licensed producer.', department: 'Customer Success', status: 'indexed' },
    { id: 'demo-3', title: 'Attendance and Timekeeping Policy', description: 'Attendance, timekeeping, and reporting procedure.', department: 'Operations', status: 'indexed' }
  ];
}

export default function App() {
  const [session, setSession] = useState(null);
  const [employee, setEmployee] = useState(null);
  const [grants, setGrants] = useState([]);
  const [activeScreen, setActiveScreen] = useState('chat');
  const [booting, setBooting] = useState(true);
  const [refreshSignal, setRefreshSignal] = useState(0);

  useEffect(() => {
    let mounted = true;

    async function boot() {
      if (!supabase) {
        setBooting(false);
        return;
      }
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setSession(data?.session || null);
      if (data?.session?.user) await loadEmployee(data.session.user);
      setBooting(false);
    }

    boot();

    const { data: authListener } = supabase?.auth?.onAuthStateChange(async (_event, nextSession) => {
      setSession(nextSession);
      if (nextSession?.user) {
        await loadEmployee(nextSession.user);
      } else {
        setEmployee(null);
        setGrants([]);
      }
    }) || { data: null };

    return () => {
      mounted = false;
      authListener?.subscription?.unsubscribe?.();
    };
  }, []);

  async function loadEmployee(user) {
    if (!user) return;

    let employeeRecord = null;
    let grantRecords = [];

    if (supabase) {
      const email = user.email || '';
      const query = supabase
        .from('employees')
        .select('*')
        .or(`auth_user_id.eq.${user.id},email.eq.${email}`)
        .limit(1)
        .maybeSingle();
      const { data, error } = await query;
      if (!error && data) employeeRecord = data;

      if (employeeRecord?.id) {
        const grantResult = await supabase
          .from('role_grants')
          .select('*')
          .or(`employee_id.eq.${employeeRecord.id},user_id.eq.${employeeRecord.id}`);
        if (!grantResult.error) grantRecords = grantResult.data || [];
      }
    }

    if (!employeeRecord) {
      const email = (user.email || '').toLowerCase();
      employeeRecord = LAVA_EMPLOYEES.find((person) => getEmployeeEmail(person).toLowerCase() === email) || {
        id: user.id,
        full_name: user.email?.split('@')[0] || 'Lava User',
        email: user.email,
        department: 'Training',
        role: 'VA'
      };
    }

    setEmployee(employeeRecord);
    setGrants(grantRecords);
  }

  function openDemo() {
    const demo = LAVA_EMPLOYEES[0];
    setSession({ user: { id: demo.id, email: demo.email }, access_token: 'demo-token' });
    setEmployee(demo);
    setGrants([{ role: 'Admin' }, { role: 'Trainer' }]);
  }

  async function logout() {
    if (supabase) await supabase.auth.signOut();
    setSession(null);
    setEmployee(null);
    setGrants([]);
  }

  const elevated = useMemo(() => hasElevatedAccess(employee, grants), [employee, grants]);
  const uploader = useMemo(() => canUpload(employee, grants), [employee, grants]);

  if (booting) {
    return (
      <ScreenShell>
        <Card><p style={styles.notice}>Loading Lava AI Assistant...</p></Card>
      </ScreenShell>
    );
  }

  if (!session || !employee) {
    return <LoginScreen onDemoLogin={openDemo} />;
  }

  return (
    <ScreenShell>
      <div style={styles.appFrame}>
        <Header employee={employee} grants={grants} activeScreen={activeScreen} setActiveScreen={setActiveScreen} onLogout={logout} />
        {activeScreen === 'chat' && <ChatScreen employee={employee} grants={grants} session={session} />}
        {activeScreen === 'library' && <LibraryScreen employee={employee} grants={grants} refreshSignal={refreshSignal} />}
        {activeScreen === 'upload' && uploader && <UploadScreen employee={employee} session={session} refreshSignal={refreshSignal} setRefreshSignal={setRefreshSignal} />}
        {activeScreen === 'audit' && elevated && <AuditScreen employee={employee} />}
      </div>
    </ScreenShell>
  );
}

const fontHeadline = '"Monument Extended", Poppins, system-ui, sans-serif';
const fontBody = 'Poppins, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

const styles = {
  pageShell: {
    minHeight: '100vh',
    background: `radial-gradient(circle at top left, rgba(231,56,53,.28), transparent 34%), linear-gradient(135deg, ${B.darkBlue}, ${B.black})`,
    color: B.darkBlue,
    fontFamily: fontBody,
    position: 'relative',
    overflow: 'hidden',
    padding: 24,
    boxSizing: 'border-box'
  },
  bgOrbOne: {
    position: 'fixed',
    width: 320,
    height: 320,
    borderRadius: '50%',
    background: 'rgba(20,83,101,.35)',
    filter: 'blur(40px)',
    right: -80,
    top: 120,
    pointerEvents: 'none'
  },
  bgOrbTwo: {
    position: 'fixed',
    width: 260,
    height: 260,
    borderRadius: '50%',
    background: 'rgba(231,56,53,.24)',
    filter: 'blur(44px)',
    left: -70,
    bottom: 80,
    pointerEvents: 'none'
  },
  appFrame: {
    width: 'min(1240px, 100%)',
    margin: '0 auto',
    position: 'relative',
    zIndex: 2
  },
  card: {
    background: 'rgba(255,255,255,.94)',
    border: '1px solid rgba(255,255,255,.55)',
    borderRadius: 28,
    boxShadow: '0 24px 70px rgba(0,0,0,.24)',
    padding: 24,
    boxSizing: 'border-box'
  },
  headerWrap: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 20,
    alignItems: 'center',
    color: B.white,
    marginBottom: 22,
    flexWrap: 'wrap'
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
    justifyContent: 'flex-end'
  },
  logoTitle: {
    margin: 0,
    fontFamily: fontHeadline,
    letterSpacing: '-.04em',
    fontSize: 'clamp(28px, 4vw, 46px)',
    lineHeight: 1
  },
  kicker: {
    color: B.red,
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: '.13em',
    fontSize: 12,
    marginBottom: 8
  },
  tabRow: {
    display: 'flex',
    gap: 8,
    background: 'rgba(255,255,255,.1)',
    border: '1px solid rgba(255,255,255,.15)',
    padding: 6,
    borderRadius: 999,
    flexWrap: 'wrap'
  },
  tab: {
    border: 0,
    background: 'transparent',
    color: B.white,
    borderRadius: 999,
    padding: '10px 14px',
    fontFamily: fontBody,
    fontWeight: 700,
    cursor: 'pointer'
  },
  tabActive: {
    border: 0,
    background: B.white,
    color: B.darkBlue,
    borderRadius: 999,
    padding: '10px 14px',
    fontFamily: fontBody,
    fontWeight: 800,
    cursor: 'pointer'
  },
  userBox: {
    color: B.white,
    display: 'grid',
    gap: 2,
    textAlign: 'right',
    fontSize: 13
  },
  loginGrid: {
    width: 'min(1080px, 100%)',
    margin: '7vh auto 0',
    display: 'grid',
    gridTemplateColumns: '1.2fr .8fr',
    gap: 24,
    position: 'relative',
    zIndex: 2
  },
  heroCard: {
    background: `linear-gradient(145deg, rgba(36,36,45,.94), rgba(27,18,11,.92)), linear-gradient(90deg, ${B.red}, ${B.teal})`,
    color: B.white,
    minHeight: 420,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center'
  },
  heroTitle: {
    margin: 0,
    fontFamily: fontHeadline,
    letterSpacing: '-.05em',
    fontSize: 'clamp(36px, 5vw, 72px)',
    lineHeight: .95,
    maxWidth: 800
  },
  heroText: {
    fontSize: 17,
    color: 'rgba(255,255,255,.82)',
    lineHeight: 1.7,
    maxWidth: 720
  },
  featureGrid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 16
  },
  sectionTitle: {
    margin: 0,
    fontFamily: fontHeadline,
    letterSpacing: '-.04em',
    fontSize: 28,
    color: B.darkBlue
  },
  smallTitle: {
    margin: '0 0 10px',
    fontFamily: fontHeadline,
    letterSpacing: '-.03em',
    fontSize: 20,
    color: B.darkBlue
  },
  muted: {
    color: 'rgba(36,36,45,.68)',
    margin: '8px 0 0',
    lineHeight: 1.6
  },
  formStack: {
    display: 'grid',
    gap: 8
  },
  label: {
    fontSize: 12,
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: '.08em',
    color: B.teal
  },
  input: {
    width: '100%',
    border: '1px solid rgba(36,36,45,.14)',
    background: B.white,
    borderRadius: 16,
    padding: '14px 15px',
    fontFamily: fontBody,
    color: B.darkBlue,
    fontSize: 14,
    boxSizing: 'border-box',
    outline: 'none'
  },
  textarea: {
    width: '100%',
    minHeight: 110,
    border: '1px solid rgba(36,36,45,.14)',
    background: B.white,
    borderRadius: 16,
    padding: '14px 15px',
    fontFamily: fontBody,
    color: B.darkBlue,
    fontSize: 14,
    boxSizing: 'border-box',
    outline: 'none',
    resize: 'vertical'
  },
  fileInput: {
    width: '100%',
    border: '1px dashed rgba(36,36,45,.24)',
    background: 'rgba(20,83,101,.05)',
    borderRadius: 18,
    padding: 18,
    boxSizing: 'border-box',
    fontFamily: fontBody
  },
  buttonPrimary: {
    border: 0,
    background: `linear-gradient(135deg, ${B.red}, ${B.teal})`,
    color: B.white,
    borderRadius: 16,
    padding: '13px 18px',
    fontFamily: fontBody,
    fontWeight: 800,
    boxShadow: '0 12px 24px rgba(231,56,53,.18)'
  },
  buttonGhost: {
    border: '1px solid rgba(255,255,255,.25)',
    background: 'rgba(255,255,255,.12)',
    color: B.white,
    borderRadius: 16,
    padding: '12px 16px',
    fontFamily: fontBody,
    fontWeight: 800
  },
  buttonLight: {
    border: '1px solid rgba(36,36,45,.12)',
    background: 'rgba(36,36,45,.06)',
    color: B.darkBlue,
    borderRadius: 16,
    padding: '12px 16px',
    fontFamily: fontBody,
    fontWeight: 800
  },
  buttonDanger: {
    border: 0,
    background: B.red,
    color: B.white,
    borderRadius: 16,
    padding: '12px 16px',
    fontFamily: fontBody,
    fontWeight: 800
  },
  notice: {
    margin: '14px 0 0',
    padding: 14,
    borderRadius: 16,
    background: 'rgba(20,83,101,.08)',
    color: B.teal,
    lineHeight: 1.6,
    fontWeight: 600
  },
  devBox: {
    marginTop: 18,
    padding: 16,
    borderRadius: 18,
    background: 'rgba(36,36,45,.06)',
    border: '1px solid rgba(36,36,45,.08)',
    lineHeight: 1.55
  },
  pill: {
    display: 'inline-flex',
    alignItems: 'center',
    width: 'fit-content',
    borderRadius: 999,
    padding: '7px 10px',
    fontSize: 12,
    fontWeight: 800
  },
  mainGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 320px',
    gap: 20
  },
  chatCard: {
    minHeight: '70vh',
    display: 'flex',
    flexDirection: 'column'
  },
  sideCard: {
    alignSelf: 'start'
  },
  chatHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    marginBottom: 18,
    flexWrap: 'wrap'
  },
  suggestionsRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 18
  },
  suggestionChip: {
    border: '1px solid rgba(20,83,101,.18)',
    background: 'rgba(20,83,101,.06)',
    color: B.teal,
    borderRadius: 999,
    padding: '9px 12px',
    fontFamily: fontBody,
    fontWeight: 700,
    cursor: 'pointer'
  },
  messageList: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    overflowY: 'auto',
    padding: '6px 2px 18px'
  },
  emptyState: {
    border: '1px dashed rgba(36,36,45,.18)',
    background: 'rgba(36,36,45,.04)',
    color: 'rgba(36,36,45,.68)',
    borderRadius: 22,
    padding: 24,
    display: 'grid',
    gap: 6,
    textAlign: 'center'
  },
  userMessage: {
    alignSelf: 'flex-end',
    background: B.darkBlue,
    color: B.white,
    borderRadius: '22px 22px 6px 22px',
    padding: 16,
    maxWidth: '78%'
  },
  assistantMessage: {
    alignSelf: 'flex-start',
    background: 'rgba(20,83,101,.07)',
    color: B.darkBlue,
    border: '1px solid rgba(20,83,101,.12)',
    borderRadius: '22px 22px 22px 6px',
    padding: 16,
    maxWidth: '88%'
  },
  messageRole: {
    fontSize: 12,
    fontWeight: 900,
    textTransform: 'uppercase',
    letterSpacing: '.08em',
    opacity: .75,
    marginBottom: 6
  },
  messageText: {
    margin: 0,
    lineHeight: 1.7,
    whiteSpace: 'pre-wrap'
  },
  answerMeta: {
    marginTop: 12,
    display: 'flex',
    gap: 8
  },
  citationList: {
    marginTop: 14,
    display: 'grid',
    gap: 10
  },
  citationCard: {
    background: B.white,
    borderRadius: 16,
    padding: 12,
    border: '1px solid rgba(36,36,45,.08)'
  },
  citationTopline: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12
  },
  sourceLink: {
    color: B.teal,
    fontWeight: 900,
    textDecoration: 'none'
  },
  sourceLinkAsText: {
    color: B.teal,
    fontWeight: 900
  },
  excerpt: {
    margin: '8px 0 0',
    color: 'rgba(36,36,45,.7)',
    lineHeight: 1.6,
    fontSize: 13
  },
  loadingBubble: {
    alignSelf: 'flex-start',
    padding: 14,
    borderRadius: 18,
    background: 'rgba(231,56,53,.08)',
    color: B.red,
    fontWeight: 800
  },
  askForm: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: 10,
    marginTop: 'auto'
  },
  cleanList: {
    margin: '0 0 18px 18px',
    padding: 0,
    color: 'rgba(36,36,45,.72)',
    lineHeight: 1.8
  },
  uploadGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 260px',
    gap: 16
  },
  toolbar: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: 12,
    marginBottom: 18
  },
  docGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: 14
  },
  docCard: {
    background: 'rgba(36,36,45,.04)',
    border: '1px solid rgba(36,36,45,.08)',
    borderRadius: 22,
    padding: 18,
    display: 'flex',
    flexDirection: 'column',
    gap: 10
  },
  docCardTopline: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap'
  },
  docTitle: {
    margin: 0,
    fontSize: 18,
    color: B.darkBlue
  },
  docDescription: {
    color: 'rgba(36,36,45,.7)',
    lineHeight: 1.55,
    margin: 0,
    flex: 1
  },
  docActions: {
    display: 'flex',
    gap: 10,
    flexWrap: 'wrap',
    marginTop: 8
  },
  linkButton: {
    display: 'inline-flex',
    alignItems: 'center',
    border: '1px solid rgba(20,83,101,.18)',
    background: 'rgba(20,83,101,.08)',
    color: B.teal,
    borderRadius: 16,
    padding: '12px 16px',
    fontWeight: 800,
    textDecoration: 'none'
  },
  tableWrap: {
    overflowX: 'auto',
    borderRadius: 18,
    border: '1px solid rgba(36,36,45,.08)'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 13
  },
  th: {
    textAlign: 'left',
    padding: 14,
    background: B.darkBlue,
    color: B.white,
    whiteSpace: 'nowrap'
  },
  td: {
    padding: 14,
    borderTop: '1px solid rgba(36,36,45,.08)',
    verticalAlign: 'top'
  },
  code: {
    whiteSpace: 'pre-wrap',
    fontSize: 12,
    color: B.teal
  }
};
