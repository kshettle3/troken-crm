import React, { useState, useEffect } from 'react';
import { Users, Plus, Phone, Mail, X, ChevronDown, ChevronUp } from 'lucide-react';
import { Contact } from '../types';
import { db } from '../db'

interface PropertyContactsProps {
  jobId: number;
}

export const PropertyContacts: React.FC<PropertyContactsProps> = ({ jobId }) => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [form, setForm] = useState({ name: '', role: '', phone: '', email: '', company: 'DMG' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadContacts();
  }, [jobId]);

  async function loadContacts() {
    try {
      const rows = await db.query(
        `SELECT * FROM contacts WHERE job_id = ${jobId} ORDER BY name ASC`
      );
      setContacts(rows as unknown as Contact[]);
    } catch (err) {
      console.error('Failed to load contacts:', err);
    }
  }

  async function handleSave() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const esc = (s: string) => s.replace(/'/g, "''");
      await db.execute(
        `INSERT INTO contacts (name, role, phone, email, company, job_id) VALUES ('${esc(form.name)}', '${esc(form.role)}', '${esc(form.phone)}', '${esc(form.email)}', '${esc(form.company)}', ${jobId})`
      );
      setForm({ name: '', role: '', phone: '', email: '', company: 'DMG' });
      setShowForm(false);
      await loadContacts();
    } catch (err) {
      console.error('Failed to add contact:', err);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    try {
      await db.execute(`DELETE FROM contacts WHERE id = ${id}`);
      setContacts(prev => prev.filter(c => c.id !== id));
    } catch (err) {
      console.error('Failed to delete contact:', err);
    }
  }

  return (
    <div className="card bg-base-200">
      <div className="card-body p-4">
        <div className="flex items-center justify-between">
          <h3
            className="font-semibold flex items-center gap-2 cursor-pointer"
            onClick={() => setExpanded(!expanded)}
          >
            <Users size={16} className="opacity-60" /> Contacts
            <span className="badge badge-sm badge-ghost">{contacts.length}</span>
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </h3>
          {expanded && (
            <button className="btn btn-ghost btn-xs" onClick={() => setShowForm(!showForm)}>
              <Plus size={14} /> Add
            </button>
          )}
        </div>

        {expanded && (
          <>
            {/* Add Form */}
            {showForm && (
              <div className="bg-base-100 rounded-lg p-3 mt-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    className="input input-bordered input-sm"
                    placeholder="Name *"
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                  />
                  <input
                    className="input input-bordered input-sm"
                    placeholder="Role (e.g. District Manager)"
                    value={form.role}
                    onChange={e => setForm({ ...form, role: e.target.value })}
                  />
                  <input
                    className="input input-bordered input-sm"
                    placeholder="Phone"
                    value={form.phone}
                    onChange={e => setForm({ ...form, phone: e.target.value })}
                  />
                  <input
                    className="input input-bordered input-sm"
                    placeholder="Email"
                    value={form.email}
                    onChange={e => setForm({ ...form, email: e.target.value })}
                  />
                </div>
                <input
                  className="input input-bordered input-sm w-full"
                  placeholder="Company"
                  value={form.company}
                  onChange={e => setForm({ ...form, company: e.target.value })}
                />
                <div className="flex gap-2 justify-end">
                  <button className="btn btn-ghost btn-xs" onClick={() => setShowForm(false)}>Cancel</button>
                  <button className="btn btn-primary btn-xs" onClick={handleSave} disabled={saving || !form.name.trim()}>Save</button>
                </div>
              </div>
            )}

            {/* Contact Cards */}
            {contacts.length === 0 && !showForm ? (
              <p className="text-sm text-base-content/50 text-center py-4 mt-2">No contacts added</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3">
                {contacts.map(c => (
                  <div key={c.id} className="bg-base-100 rounded-lg p-3 relative group">
                    <button
                      className="btn btn-ghost btn-xs absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-error"
                      onClick={() => handleDelete(c.id)}
                    >
                      <X size={12} />
                    </button>
                    <div className="font-medium text-sm">{c.name}</div>
                    {c.role && <div className="text-xs text-base-content/60">{c.role}</div>}
                    {c.company && <div className="text-xs text-base-content/50">{c.company}</div>}
                    <div className="flex flex-wrap gap-3 mt-2">
                      {c.phone && (
                        <a href={`tel:${c.phone}`} className="flex items-center gap-1 text-xs text-primary hover:underline">
                          <Phone size={12} /> {c.phone}
                        </a>
                      )}
                      {c.email && (
                        <a href={`mailto:${c.email}`} className="flex items-center gap-1 text-xs text-primary hover:underline">
                          <Mail size={12} /> {c.email}
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
