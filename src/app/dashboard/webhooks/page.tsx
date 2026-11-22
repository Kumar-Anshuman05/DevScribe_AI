"use client";

import React, { useState, useEffect } from "react";
import { Card, Button, Badge } from "@/components/ui";
import { Webhook, Plus, Trash2, CheckCircle2, ShieldCheck, Copy, Check } from "lucide-react";

export default function WebhooksPage() {
  const [endpoints, setEndpoints] = useState<any[]>([]);
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  async function loadWebhooks() {
    const res = await fetch("/api/v1/webhooks");
    const data = await res.json();
    if (data.success) {
      setEndpoints(data.data || []);
    }
  }

  useEffect(() => {
    loadWebhooks();
  }, []);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!url) return;
    setLoading(true);

    try {
      const res = await fetch("/api/v1/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          description: description || undefined,
          eventTypes: ["job.completed", "job.failed"],
        }),
      });

      const data = await res.json();
      if (data.success) {
        setCreatedSecret(data.data.secret);
        setUrl("");
        setDescription("");
        loadWebhooks();
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this webhook endpoint?")) return;
    await fetch(`/api/v1/webhooks/${id}`, { method: "DELETE" });
    loadWebhooks();
  }

  function handleCopy() {
    if (createdSecret) {
      navigator.clipboard.writeText(createdSecret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Webhook Subscriptions</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Deliver signed HTTP POST notifications for job.completed and job.failed events with delivery-level lease fencing.
        </p>
      </div>

      {/* Secret Reveal Banner */}
      {createdSecret && (
        <Card className="p-5 border-emerald-500/40 bg-emerald-500/10 space-y-2">
          <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
            <ShieldCheck className="h-4 w-4" /> Save Your Webhook Signing Secret
          </div>
          <p className="text-xs text-muted-foreground">
            This secret is used to verify HMAC-SHA256 signatures in the <code>X-DevScribe-Signature</code> header.
          </p>
          <div className="flex items-center gap-2 pt-2">
            <code className="bg-background px-3 py-1.5 rounded border border-border font-mono text-xs flex-1 select-all text-emerald-300">
              {createdSecret}
            </code>
            <Button size="sm" onClick={handleCopy} className="gap-1.5">
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </Card>
      )}

      {/* Register Form */}
      <Card className="p-5">
        <form onSubmit={handleRegister} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold">Destination HTTPS URL *</label>
              <input
                type="url"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://your-domain.com/api/webhooks"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold">Description (Optional)</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Production Headless CMS Webhook"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={loading} className="gap-1.5">
              <Plus className="h-4 w-4" /> Register Webhook
            </Button>
          </div>
        </form>
      </Card>

      {/* Endpoints List */}
      <div className="space-y-3">
        <h2 className="text-base font-bold">Registered Webhook Listeners</h2>
        {endpoints.length === 0 ? (
          <Card className="p-8 text-center text-xs text-muted-foreground">
            No webhook endpoints registered yet. Register an endpoint above to receive automated delivery notifications.
          </Card>
        ) : (
          <div className="space-y-2">
            {endpoints.map((ep) => (
              <Card key={ep.id} className="p-4 flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-primary">{ep.url}</span>
                    <Badge variant="success" className="text-[10px]">
                      Active
                    </Badge>
                  </div>
                  <div className="text-[11px] text-muted-foreground flex items-center gap-3">
                    <span>Events: {ep.eventTypes.join(", ")}</span>
                    {ep.description && <span>• {ep.description}</span>}
                  </div>
                </div>

                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleDelete(ep.id)}
                  className="gap-1"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
