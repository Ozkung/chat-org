'use client';

import { useEffect } from 'react';
import { useEditor, useEditorState, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';

const TOOLBAR = [
  { label: 'B', title: 'Bold', isActive: (e) => e.isActive('bold'), run: (c) => c.toggleBold(), style: { fontWeight: 700 } },
  { label: 'I', title: 'Italic', isActive: (e) => e.isActive('italic'), run: (c) => c.toggleItalic(), style: { fontStyle: 'italic' } },
  { label: 'S', title: 'Strike', isActive: (e) => e.isActive('strike'), run: (c) => c.toggleStrike(), style: { textDecoration: 'line-through' } },
  { label: 'H2', title: 'Heading', isActive: (e) => e.isActive('heading', { level: 2 }), run: (c) => c.toggleHeading({ level: 2 }) },
  { label: '•', title: 'Bullet list', isActive: (e) => e.isActive('bulletList'), run: (c) => c.toggleBulletList() },
  { label: '1.', title: 'Numbered list', isActive: (e) => e.isActive('orderedList'), run: (c) => c.toggleOrderedList() },
  { label: '</>', title: 'Code block', isActive: (e) => e.isActive('codeBlock'), run: (c) => c.toggleCodeBlock() },
];

// Rich-text editor bound to a Y.XmlFragment, with live carets of other people.
export default function TiptapEditor({ fragment, provider, user, editable = true }) {
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ undoRedo: false }), // Collaboration ships its own Yjs-aware undo
        Collaboration.configure({ fragment }),
        CollaborationCaret.configure({ provider, user }),
      ],
      editable,
      immediatelyRender: false, // required for SSR-safe rendering in Next.js
      editorProps: { attributes: { class: 'tiptap-content' } },
    },
    [fragment, provider],
  );

  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.commands.updateUser(user);
  }, [editor, user]);

  // Tiptap v3 doesn't re-render on every transaction, so subscribe to toolbar state explicitly.
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => (e ? TOOLBAR.map((btn) => btn.isActive(e)) : []),
  });

  if (!editor) return <div className="tiptap-wrapper tiptap-loading">Loading editor…</div>;
  if (!editable) {
    return (
      <div className="tiptap-wrapper">
        <EditorContent editor={editor} className="nowheel" />
      </div>
    );
  }

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
