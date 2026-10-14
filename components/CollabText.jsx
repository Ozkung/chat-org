'use client';

import { useEffect, useRef } from 'react';

// Shift a caret index through a remote Yjs delta so the local cursor stays put.
function transformIndex(index, delta) {
  let pos = 0;
  let result = index;
  for (const op of delta) {
    if (op.retain) {
      pos += op.retain;
    } else if (op.insert) {
      const len = typeof op.insert === 'string' ? op.insert.length : 1;
      if (pos < index) result += len;
      pos += len;
    } else if (op.delete) {
      if (pos < index) result -= Math.min(op.delete, index - pos);
    }
    if (pos > index) break;
  }
  return result;
}

/**
 * An uncontrolled <input>/<textarea> bound to a Y.Text.
 * Local edits are applied as a minimal splice so concurrent typing merges character by character.
 */
export default function CollabText({ ytext, multiline = false, onValue, ...props }) {
  const ref = useRef(null);
  const onValueRef = useRef(onValue);
  onValueRef.current = onValue;

  useEffect(() => {
    const el = ref.current;
    el.value = ytext.toString();
    onValueRef.current?.(el.value);

    const observer = (event) => {
      const next = ytext.toString();
      if (el.value !== next) {
        const focused = document.activeElement === el;
        const start = transformIndex(el.selectionStart ?? 0, event.delta);
        const end = transformIndex(el.selectionEnd ?? 0, event.delta);
        el.value = next;
        if (focused) el.setSelectionRange(start, end);
      }
      onValueRef.current?.(next);
    };
    ytext.observe(observer);
    return () => ytext.unobserve(observer);
  }, [ytext]);

  const handleChange = (e) => {
    const value = e.target.value;
    const old = ytext.toString();
    if (value === old) return;

    let start = 0;
    while (start < old.length && start < value.length && old[start] === value[start]) start++;
    let endOld = old.length;
    let endNew = value.length;
    while (endOld > start && endNew > start && old[endOld - 1] === value[endNew - 1]) {
      endOld--;
      endNew--;
    }

    ytext.doc.transact(() => {
      if (endOld > start) ytext.delete(start, endOld - start);
      if (endNew > start) ytext.insert(start, value.slice(start, endNew));
    });
  };

  const Tag = multiline ? 'textarea' : 'input';
  return <Tag ref={ref} onChange={handleChange} {...props} />;
}
