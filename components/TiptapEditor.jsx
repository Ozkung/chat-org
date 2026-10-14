'use client';

import { useEffect } from 'react';
import { useEditor, useEditorState, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

const TOOLBAR = [
  { label: 'B', title: 'Bold', isActive: (e) => e.isActive('bold'), run: (c) => c.toggleBold(), style: { fontWeight: 700 } },
  { label: 'I', title: 'Italic', isActive: (e) => e.isActive('italic'), run: (c) => c.toggleItalic(), style: { fontStyle: 'italic' } },
  { label: 'S', title: 'Strike', isActive: (e) => e.isActive('strike'), run: (c) => c.toggleStrike(), style: { textDecoration: 'line-through' } },
  { label: 'H2', title: 'Heading', isActive: (e) => e.isActive('heading', { level: 2 }), run: (c) => c.toggleHeading({ level: 2 }) },
  { label: '•', title: 'Bullet list', isActive: (e) => e.isActive('bulletList'), run: (c) => c.toggleBulletList() },
  { label: '1.', title: 'Numbered list', isActive: (e) => e.isActive('orderedList'), run: (c) => c.toggleOrderedList() },
  { label: '</>', title: 'Code block', isActive: (e) => e.isActive('codeBlock'), run: (c) => c.toggleCodeBlock() },
];

export default function TiptapEditor({ value, onChange }) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: value,
    immediatelyRender: false, // required for SSR-safe rendering in Next.js
    editorProps: { attributes: { class: 'tiptap-content' } },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  // Tiptap v3 doesn't re-render on every transaction, so subscribe to toolbar state explicitly.
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => (e ? TOOLBAR.map((btn) => btn.isActive(e)) : []),
  });

  // Sync external changes (e.g. importing a board) without clobbering active typing.
  useEffect(() => {
    if (editor && !editor.isFocused && value !== editor.getHTML()) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [editor, value]);

  if (!editor) return <div className="tiptap-wrapper tiptap-loading">Loading editor…</div>;

  return (
    <div className="tiptap-wrapper">
      <div className="tiptap-toolbar">
        {TOOLBAR.map((btn, i) => (
          <button
            key={btn.title}
            type="button"
            title={btn.title}
            style={btn.style}
            className={active?.[i] ? 'is-active' : ''}
            onMouseDown={(e) => e.preventDefault()} // keep editor selection
            onClick={() => btn.run(editor.chain().focus()).run()}
          >
            {btn.label}
          </button>
        ))}
      </div>
      <EditorContent editor={editor} className="nowheel" />
    </div>
  );
}
