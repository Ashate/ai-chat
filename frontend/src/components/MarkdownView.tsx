import React from 'react';

interface Props {
  content: string;
}

const MarkdownView: React.FC<Props> = ({ content }) => {
  // 简单处理代码块 ``` 包裹的内容
  const parts: { type: 'code' | 'text'; text: string }[] = [];
  const lines = content.split('\n');
  let inCode = false;
  let buf: string[] = [];
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      if (!inCode) {
        if (buf.length) {
          parts.push({ type: 'text', text: buf.join('\n') });
          buf = [];
        }
        inCode = true;
      } else {
        parts.push({ type: 'code', text: buf.join('\n') });
        buf = [];
        inCode = false;
      }
    } else {
      buf.push(line);
    }
  }
  if (buf.length) {
    parts.push({ type: inCode ? 'code' : 'text', text: buf.join('\n') });
  }

  const handleCopy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      alert('代码已复制');
    } catch {
      alert('复制失败');
    }
  };

  return (
    <div className="markdown-view">
      {parts.map((p, idx) =>
        p.type === 'code' ? (
          <div className="code-block" key={idx}>
            <button
              className="code-copy-btn"
              onClick={() => handleCopy(p.text)}
            >
              复制
            </button>
            <pre>
              <code>{p.text}</code>
            </pre>
          </div>
        ) : (
          <p key={idx}>
            {p.text.split('\n').map((l, i) => (
              <React.Fragment key={i}>
                {l}
                <br />
              </React.Fragment>
            ))}
          </p>
        )
      )}
    </div>
  );
};

export default MarkdownView;
