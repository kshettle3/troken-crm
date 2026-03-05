import React, { useState, useEffect } from 'react';
import { MessageSquare, Send, Lock, Share2 } from 'lucide-react';
import { Note } from '../types';
import { db } from '../db'

interface PropertyNotesProps {
  jobId: number;
  /** 'owner' sees internal + shared; 'sub' sees shared + contractor */
  viewMode: 'owner' | 'sub';
}

const TAB_CONFIG = {
  owner: [
    { type: 'internal' as const, label: 'Internal', icon: Lock, desc: 'Only you can see these' },
    { type: 'shared' as const, label: 'Shared', icon: Share2, desc: 'Visible to you and your sub' },
  ],
  sub: [
    { type: 'shared' as const, label: 'Shared', icon: Share2, desc: 'Visible to you and Troken' },
    { type: 'contractor' as const, label: 'My Notes', icon: MessageSquare, desc: 'Only you can see these' },
  ],
};

export const PropertyNotes: React.FC<PropertyNotesProps> = ({ jobId, viewMode }) => {
  const tabs = TAB_CONFIG[viewMode];
  const [activeTab, setActiveTab] = useState<'internal' | 'shared' | 'contractor'>(tabs[0].type);
  const [notes, setNotes] = useState<Note[]>([]);
  const [newNote, setNewNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState('');

  useEffect(() => {
    loadNotes();
  }, [jobId, activeTab]);

  async function loadNotes() {
    try {
      const rows = await db.query(
        `SELECT * FROM notes WHERE job_id = ${jobId} AND note_type = '${activeTab}' ORDER BY created_at DESC`
      );
      setNotes(rows as unknown as Note[]);
    } catch (err) {
      console.error('Failed to load notes:', err);
    }
  }

  async function handleAdd() {
    if (!newNote.trim()) return;
    setSaving(true);
    try {
      await db.execute(
        `INSERT INTO notes (job_id, note_type, content) VALUES (${jobId}, '${activeTab}', '${newNote.replace(/'/g, "''")}')`
      );
      setNewNote('');
      await loadNotes();
    } catch (err) {
      console.error('Failed to add note:', err);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(noteId: number) {
    try {
      await db.execute(`DELETE FROM notes WHERE id = ${noteId}`);
      setNotes(prev => prev.filter(n => n.id !== noteId));
    } catch (err) {
      console.error('Failed to delete note:', err);
    }
  }

  async function handleEdit(noteId: number) {
    if (!editContent.trim()) return;
    try {
      await db.execute(
        `UPDATE notes SET content = '${editContent.replace(/'/g, "''")}' WHERE id = ${noteId}`
      );
      setEditingNoteId(null);
      setEditContent('');
      await loadNotes();
    } catch (err) {
      console.error('Failed to edit note:', err);
    }
  }

  function formatTimestamp(ts: string) {
    const d = new Date(ts + (ts.includes('Z') || ts.includes('+') ? '' : 'Z'));
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  return (
    <div className="card bg-base-200">
      <div className="card-body p-4">
        <h3 className="font-semibold flex items-center gap-2 mb-3">
          <MessageSquare size={16} className="opacity-60" /> Notes
        </h3>

        {/* Tabs */}
        <div className="tabs tabs-boxed bg-base-300 mb-3">
          {tabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.type}
                className={`tab tab-sm gap-1 ${activeTab === tab.type ? 'tab-active' : ''}`}
                onClick={() => setActiveTab(tab.type)}
              >
                <Icon size={14} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Description */}
        <p className="text-xs text-base-content/50 mb-3">
          {tabs.find(t => t.type === activeTab)?.desc}
        </p>

        {/* Add Note */}
        <div className="flex gap-2 mb-3">
          <textarea
            className="textarea textarea-bordered textarea-sm flex-1"
            placeholder="Add a note..."
            rows={2}
            value={newNote}
            onChange={e => setNewNote(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAdd(); } }}
          />
          <button
            className="btn btn-primary btn-sm self-end"
            onClick={handleAdd}
            disabled={saving || !newNote.trim()}
          >
            <Send size={14} />
          </button>
        </div>

        {/* Notes List */}
        {notes.length === 0 ? (
          <p className="text-sm text-base-content/50 text-center py-4">No notes yet</p>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {notes.map(note => (
              <div key={note.id} className="bg-base-100 rounded-lg p-3 relative group">
                {editingNoteId === note.id ? (
                  // Edit mode
                  <div className="space-y-2">
                    <textarea
                      className="textarea textarea-bordered textarea-sm w-full"
                      rows={3}
                      value={editContent}
                      onChange={e => setEditContent(e.target.value)}
                      autoFocus
                    />
                    <div className="flex gap-2 justify-end">
                      <button
                        className="btn btn-ghost btn-xs"
                        onClick={() => { setEditingNoteId(null); setEditContent(''); }}
                      >
                        Cancel
                      </button>
                      <button
                        className="btn btn-primary btn-xs"
                        onClick={() => handleEdit(note.id)}
                        disabled={!editContent.trim()}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  // View mode
                  <>
                    <p className="text-sm whitespace-pre-wrap">{note.content}</p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs text-base-content/40">{formatTimestamp(note.created_at)}</span>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          className="btn btn-ghost btn-xs"
                          onClick={() => { setEditingNoteId(note.id); setEditContent(note.content); }}
                        >
                          Edit
                        </button>
                        <button
                          className="btn btn-ghost btn-xs text-error"
                          onClick={() => handleDelete(note.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
