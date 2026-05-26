import { Fragment, ReactNode } from 'react';

/** Renders exam text with backticks and snake_case identifiers as inline code. */
export function FormatText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const re = /`([^`]+)`|\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }
    const code = match[1] ?? match[2];
    parts.push(
      <code key={key++} className="inline-code">
        {code}
      </code>,
    );
    last = match.index + match[0].length;
  }

  if (last < text.length) {
    parts.push(text.slice(last));
  }

  if (parts.length === 0) return <>{text}</>;
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>{part}</Fragment>
      ))}
    </>
  );
}
