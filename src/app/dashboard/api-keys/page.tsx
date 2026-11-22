"use client";

import React, { useState, useEffect } from "react";
import { Card, Button, Badge } from "@/components/ui";
import { Key, Copy, Check, Trash2, Plus, ShieldAlert } from "lucide-react";

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  async function loadKeys() {
    const res = await fetch("/api/v1/api-keys");
    const data = await res.json();
    if (data.success) {
      setKeys(data.data || []);
    }
  }

  useEffect(() => {
    loadKeys();
  }, []);

  async function handleCreateKey(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/v1/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name || "Production API Key" }),
      });
      const data = await res.json();
      if (data.success) {
        setCreatedKey(data.data.plaintextKey);
        setName("");
        loadKeys();
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleRevokeKey(id: string) {
    if (!confirm("Revoke this API Key immediately?")) return;
    await fetch(`/api/v1/api-keys/${id}`, { method: "DELETE" });
    loadKeys();
  }

  function handleCopy() {
    if (createdKey) {
      navigator.clipboard.writeText(createdKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">API Key Management</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Cryptographically hashed SHA-256 API keys with scoped authorization for programmatic job submissions.
        </p>
      </div>

      {/* Created Key Banner */}
      {createdKey && (
        <Card className="p-5 border-emerald-500/40 bg-emerald-500/10 space-y-2">
          <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
            <Key className="h-4 w-4" /> Save your API Key Now
          </div>
          <p className="text-xs text-muted-foreground">
            This plaintext secret is shown ONLY ONCE. Store it in your password manager or environment variables.
          </p>
          <div className="flex items-center gap-2 pt-2">
            <code className="bg-background px-3 py-1.5 rounded border border-border font-mono text-xs flex-1 select-all text-emerald-300">
              {createdKey}
            </code>
            <Button size="sm" onClick={handleCopy} className="gap-1.5">
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </Card>
      )}

      {/* Key Creation Form */}
      <Card className="p-5">
        <form onSubmit={handleCreateKey} className="flex flex-col sm:flex-row items-end gap-3">
          <div className="space-y-1.5 flex-1 w-full">
            <label className="text-xs font-semibold">Key Description / Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Production Ingestion Service"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <Button type="submit" disabled={loading} className="gap-1.5 shrink-0">
            <Plus className="h-4 w-4" /> Create API Key
          </Button>
        </form>
      </Card>

      {/* Keys Table */}
      <div className="space-y-3">
        <h2 className="text-base font-bold">Active API Keys</h2>
        {keys.length === 0 ? (
          <Card className="p-8 text-center text-xs text-muted-foreground">
            No API keys created yet. Generate one above to access REST API endpoints.
          </Card>
        ) : (
          <div className="space-y-2">
            {keys.map((k) => (
              <Card key={k.id} className="p-4 flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">{k.name}</span>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {k.keyPrefix}...
                    </Badge>
                  </div>
                  <div className="text-[11px] text-muted-foreground flex items-center gap-3">
                    <span>Scopes: {k.scopes.join(", ")}</span>
                    <span>•</span>
                    <span>Created: {new Date(k.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>

                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleRevokeKey(k.id)}
                  className="gap-1"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Revoke
                </Button>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
