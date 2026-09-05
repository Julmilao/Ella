import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import { apiFetch, fetchSchedulerJobs, subscribeSchedulerUpdated, type SchedulerJob } from "@/services/api";
import {
  Settings, Save, Loader2, Shield, Eye, EyeOff, CalendarClock, RefreshCw, Send, CheckCircle2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

// ── Tipos ─────────────────────────────────────────────────────────────────────
interface ConfigData {
  id?: number;
  exp_usuario: string;
  exp_senha: string;
  smtp_host: string;
  smtp_porta: number;
  smtp_usuario: string;
  smtp_senha: string;
  smtp_de_nome: string;
  smtp_usar_tls: boolean;
  smtp_tipo_conexao: string;
  smtp_ignorar_cert: boolean;
  pdf_nome_empresa: string;
  pdf_cabecalho: string;
  pdf_rodape: string;
  rpa_headless: boolean;
  rpa_timeout_ms: number;
  rpa_tentativas: number;
  rpa_delay_entre_os_ms: number;
  rpa_debug_video: boolean;
  rpa_debug_trace: boolean;
}

const DEFAULT_CONFIG: ConfigData = {
  exp_usuario: "",
  exp_senha: "",
  smtp_host: "smtp.gmail.com",
  smtp_porta: 587,
  smtp_usuario: "",
  smtp_senha: "",
  smtp_de_nome: "ELLA SO",
  smtp_usar_tls: true,
  smtp_tipo_conexao: "tls",
  smtp_ignorar_cert: false,
  pdf_nome_empresa: "",
  pdf_cabecalho: "Relatório de Status",
  pdf_rodape: "Gerado pelo ELLA SO",
  rpa_headless: true,
  rpa_timeout_ms: 30000,
  rpa_tentativas: 2,
  rpa_delay_entre_os_ms: 800,
  rpa_debug_video: false,
  rpa_debug_trace: false,
};

// ── Página principal ──────────────────────────────────────────────────────────
export default function Admin() {
  const { toast } = useToast();

  const [config, setConfig] = useState<ConfigData>(DEFAULT_CONFIG);
  const [configLoading, setConfigLoading] = useState(true);
  const [configSaving, setConfigSaving] = useState(false);
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [schedulerJobs, setSchedulerJobs] = useState<SchedulerJob[]>([]);
  const [schedulerLoading, setSchedulerLoading] = useState(true);
  const [smtpTestEmail, setSmtpTestEmail] = useState("");
  const [smtpTesting, setSmtpTesting] = useState(false);
  const [smtpConfirming, setSmtpConfirming] = useState(false);

  const loadScheduler = useCallback(async () => {
    setSchedulerLoading(true);
    try {
      const jobs = await fetchSchedulerJobs();
      setSchedulerJobs(jobs);
    } catch (err: any) {
      toast({ title: "Erro ao carregar scheduler", description: err.message, variant: "destructive" });
    } finally {
      setSchedulerLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadConfig();
  }, []);

  useEffect(() => {
    loadScheduler();
    return subscribeSchedulerUpdated(loadScheduler);
  }, [loadScheduler]);

  // ── Carrega configuração geral ──
  async function loadConfig() {
    setConfigLoading(true);
    const { data } = await supabase
      .from("configuracoes_gerais")
      .select("*")
      .limit(1)
      .maybeSingle();

    if (data) {
      setConfig({
        id:                   data.id,
        exp_usuario:          data.exp_usuario || "",
        exp_senha:            data.exp_senha || "",
        smtp_host:            data.smtp_host || "smtp.gmail.com",
        smtp_porta:           data.smtp_porta || 587,
        smtp_usuario:         data.smtp_usuario || "",
        smtp_senha:           data.smtp_senha || "",
        smtp_de_nome:         data.smtp_de_nome || "ELLA SO",
        smtp_usar_tls:        data.smtp_usar_tls ?? true,
        smtp_tipo_conexao:    data.smtp_tipo_conexao || "tls",
        smtp_ignorar_cert:    data.smtp_ignorar_cert ?? false,
        pdf_nome_empresa:     data.pdf_nome_empresa || "",
        pdf_cabecalho:        data.pdf_cabecalho || "Relatório de Status",
        pdf_rodape:           data.pdf_rodape || "Gerado pelo ELLA SO",
        rpa_headless:         data.rpa_headless ?? true,
        rpa_timeout_ms:       data.rpa_timeout_ms || 30000,
        rpa_tentativas:       data.rpa_tentativas || 2,
        rpa_delay_entre_os_ms: data.rpa_delay_entre_os_ms || 800,
        rpa_debug_video:      data.rpa_debug_video ?? false,
        rpa_debug_trace:      data.rpa_debug_trace ?? false,
      });
    }
    setConfigLoading(false);
  }

  async function saveConfig() {
    setConfigSaving(true);
    try {
      const payload = {
        exp_usuario:           config.exp_usuario,
        exp_senha:             config.exp_senha,
        smtp_host:             config.smtp_host,
        smtp_porta:            config.smtp_porta,
        smtp_usuario:          config.smtp_usuario,
        smtp_senha:            config.smtp_senha,
        smtp_de_nome:          config.smtp_de_nome,
        smtp_usar_tls:         config.smtp_usar_tls,
        smtp_tipo_conexao:     config.smtp_tipo_conexao,
        smtp_ignorar_cert:     config.smtp_ignorar_cert,
        pdf_nome_empresa:      config.pdf_nome_empresa,
        pdf_cabecalho:         config.pdf_cabecalho,
        pdf_rodape:            config.pdf_rodape,
        rpa_headless:          config.rpa_headless,
        rpa_timeout_ms:        config.rpa_timeout_ms,
        rpa_tentativas:        config.rpa_tentativas,
        rpa_delay_entre_os_ms: config.rpa_delay_entre_os_ms,
        rpa_debug_video:       config.rpa_debug_video,
        rpa_debug_trace:       config.rpa_debug_trace,
      };

      if (config.id) {
        const { error } = await supabase.from("configuracoes_gerais").update(payload).eq("id", config.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("configuracoes_gerais").insert(payload).select().single();
        if (error) throw error;
        if (data) setConfig((prev) => ({ ...prev, id: data.id }));
      }

      toast({ title: "Configurações salvas", description: "As configurações foram atualizadas com sucesso." });
    } catch (err: any) {
      toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" });
    }
    setConfigSaving(false);
  }

  // ── SMTP — Confirmar conexão ──
  async function confirmarSmtp() {
    setSmtpConfirming(true);
    try {
      const res = await apiFetch("/smtp/testar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destinatario: config.smtp_usuario || "test@test.com" }),
      });
      if (res.ok) {
        toast({ title: "Conexão confirmada", description: "SMTP respondeu com sucesso." });
      } else {
        const body = await res.json().catch(() => ({}));
        toast({ title: "Falha na conexão SMTP", description: body.detail || "Verifique host/porta/credenciais.", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Erro de rede", description: err.message, variant: "destructive" });
    } finally {
      setSmtpConfirming(false);
    }
  }

  // ── SMTP — Enviar e-mail de teste ──
  async function testarSmtp() {
    if (!smtpTestEmail) {
      toast({ title: "Informe o destinatário", description: "Digite um e-mail para receber o teste.", variant: "destructive" });
      return;
    }
    setSmtpTesting(true);
    try {
      const res = await apiFetch("/smtp/testar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destinatario: smtpTestEmail }),
      });
      if (res.ok) {
        toast({ title: "E-mail de teste enviado", description: `Mensagem enviada para ${smtpTestEmail}.` });
      } else {
        const body = await res.json().catch(() => ({}));
        toast({ title: "Falha no envio", description: body.detail || "Verifique as configurações SMTP.", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Erro de rede", description: err.message, variant: "destructive" });
    } finally {
      setSmtpTesting(false);
    }
  }

  // ── Helper de senha com toggle ──
  const togglePassword = (field: string) =>
    setShowPasswords((prev) => ({ ...prev, [field]: !prev[field] }));

  const PasswordInput = ({ field, value, onChange }: { field: string; value: string; onChange: (v: string) => void }) => (
    <div className="relative">
      <Input
        type={showPasswords[field] ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pr-10 bg-background border-border"
      />
      <button
        type="button"
        onClick={() => togglePassword(field)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
      >
        {showPasswords[field] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );

  return (
    <AppLayout
      title="Configurações do Sistema"
      subtitle="SMTP, PDF e credenciais do usuário RPA"
    >
      {configLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <div className="space-y-4">
          <Card className="border-border bg-card">
            <CardHeader className="pb-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <CalendarClock className="h-4 w-4 text-primary" />
                    Scheduler — Jobs Ativos
                  </CardTitle>
                  <CardDescription>
                    Os jobs refletem as rotinas ativas e atualizam automaticamente quando você salva alterações em Rotinas ou Clientes.
                  </CardDescription>
                </div>
                <Button variant="outline" size="sm" className="gap-2" onClick={loadScheduler} disabled={schedulerLoading}>
                  {schedulerLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Recarregar
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {schedulerLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Carregando jobs do scheduler...
                </div>
              ) : schedulerJobs.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
                  Nenhuma rotina ativa encontrada.
                </div>
              ) : (
                <div className="space-y-2">
                  {schedulerJobs.map((job) => (
                    <div
                      key={job.id}
                      className="flex flex-col gap-2 rounded-xl border border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-sm text-foreground">{job.nome}</div>
                        <div className="text-xs text-muted-foreground">{job.cliente}</div>
                        <div className="mt-1 font-mono text-[11px] text-primary">{job.schedule}</div>
                      </div>
                      <div className="text-xs text-muted-foreground sm:text-right">
                        <div className="font-medium text-foreground">{job.resumo}</div>
                        <div className="capitalize">{job.periodo}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          {/* ── Experience / RPA ── */}
          <Card className="border-border bg-card">
            <CardHeader className="pb-4">
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="h-4 w-4 text-primary" />
                Experience / RPA — Global
              </CardTitle>
              <CardDescription>
                Credenciais globais de login do usuário RPA. O link de abertura da OS fica configurado em cada cliente.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground">Usuário RPA</Label>
                  <Input
                    value={config.exp_usuario}
                    onChange={(e) => setConfig((p) => ({ ...p, exp_usuario: e.target.value }))}
                    placeholder="Login da conta de serviço"
                    className="bg-background border-border"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground">Senha RPA</Label>
                  <PasswordInput
                    field="exp_senha"
                    value={config.exp_senha}
                    onChange={(v) => setConfig((p) => ({ ...p, exp_senha: v }))}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── SMTP ── */}
          <Card className="border-border bg-card">
            <CardHeader className="pb-4">
              <CardTitle className="text-base flex items-center gap-2">
                <Settings className="h-4 w-4 text-primary" />
                SMTP — E-mail de Saída
              </CardTitle>
              <CardDescription>Configurações do servidor de e-mail para envio de relatórios</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground">Host SMTP</Label>
                  <Input
                    value={config.smtp_host}
                    onChange={(e) => setConfig((p) => ({ ...p, smtp_host: e.target.value }))}
                    className="bg-background border-border"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground">Porta</Label>
                  <Input
                    type="number"
                    value={config.smtp_porta}
                    onChange={(e) => setConfig((p) => ({ ...p, smtp_porta: Number(e.target.value) }))}
                    className="bg-background border-border"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground">E-mail Remetente</Label>
                  <Input
                    value={config.smtp_usuario}
                    onChange={(e) => setConfig((p) => ({ ...p, smtp_usuario: e.target.value }))}
                    className="bg-background border-border"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground">Senha SMTP</Label>
                  <PasswordInput
                    field="smtp_senha"
                    value={config.smtp_senha}
                    onChange={(v) => setConfig((p) => ({ ...p, smtp_senha: v }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground">Nome do Remetente (De:)</Label>
                  <Input
                    value={config.smtp_de_nome}
                    onChange={(e) => setConfig((p) => ({ ...p, smtp_de_nome: e.target.value }))}
                    className="bg-background border-border"
                  />
                </div>
                <div className="flex items-center gap-3 pt-6">
                  <Switch
                    checked={config.smtp_usar_tls}
                    onCheckedChange={(v) => setConfig((p) => ({ ...p, smtp_usar_tls: v }))}
                  />
                  <Label className="text-xs font-medium text-muted-foreground">Ativar STARTTLS (porta 587)</Label>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground">Tipo de conexão</Label>
                  <select
                    value={config.smtp_tipo_conexao}
                    onChange={(e) => setConfig((p) => ({ ...p, smtp_tipo_conexao: e.target.value }))}
                    className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm"
                  >
                    <option value="tls">TLS (STARTTLS — porta 587)</option>
                    <option value="ssl">SSL (porta 465)</option>
                    <option value="none">Sem criptografia (porta 25)</option>
                  </select>
                </div>
                <div className="flex items-center gap-3 pt-2">
                  <Switch
                    checked={config.smtp_ignorar_cert}
                    onCheckedChange={(v) => setConfig((p) => ({ ...p, smtp_ignorar_cert: v }))}
                  />
                  <Label className="text-xs font-medium text-muted-foreground">Ignorar erros de certificado SSL</Label>
                </div>
              </div>

              {/* ── Testar conexão / envio ── */}
              <div className="border-t border-border pt-4 space-y-3">
                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={confirmarSmtp}
                    disabled={smtpConfirming}
                  >
                    {smtpConfirming ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4 text-green-500" />}
                    Confirmar
                  </Button>
                  <span className="text-xs text-muted-foreground">Testa a conexão com o servidor SMTP</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 space-y-1">
                    <Label className="text-xs font-medium text-muted-foreground">Destinatário</Label>
                    <Input
                      type="email"
                      placeholder="email@exemplo.com"
                      value={smtpTestEmail}
                      onChange={(e) => setSmtpTestEmail(e.target.value)}
                      className="bg-background border-border"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-2 mt-5"
                    onClick={testarSmtp}
                    disabled={smtpTesting}
                  >
                    {smtpTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Testar
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── PDF ── */}
          <Card className="border-border bg-card">
            <CardHeader className="pb-4">
              <CardTitle className="text-base flex items-center gap-2">
                <Settings className="h-4 w-4 text-primary" />
                PDF — Relatórios
              </CardTitle>
              <CardDescription>Textos exibidos nos relatórios PDF gerados pelo sistema</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2 md:col-span-2">
                  <Label className="text-xs font-medium text-muted-foreground">Nome da Empresa (cabeçalho)</Label>
                  <Input
                    value={config.pdf_nome_empresa}
                    onChange={(e) => setConfig((p) => ({ ...p, pdf_nome_empresa: e.target.value }))}
                    className="bg-background border-border"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground">Título do Relatório</Label>
                  <Input
                    value={config.pdf_cabecalho}
                    onChange={(e) => setConfig((p) => ({ ...p, pdf_cabecalho: e.target.value }))}
                    className="bg-background border-border"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground">Rodapé</Label>
                  <Input
                    value={config.pdf_rodape}
                    onChange={(e) => setConfig((p) => ({ ...p, pdf_rodape: e.target.value }))}
                    className="bg-background border-border"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── RPA ── */}
          <Card className="border-border bg-card">
            <CardHeader className="pb-4">
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="h-4 w-4 text-primary" />
                RPA — Motor de Automação
              </CardTitle>
              <CardDescription>
                Parâmetros do Playwright para abertura automática de OS no Sankhya Experience
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-center gap-3 md:col-span-2">
                  <Switch
                    checked={config.rpa_headless}
                    onCheckedChange={(v) => setConfig((p) => ({ ...p, rpa_headless: v }))}
                  />
                  <div>
                    <Label className="text-xs font-medium text-muted-foreground">Modo headless</Label>
                    <p className="text-[11px] text-muted-foreground">Executa o navegador sem janela visível (recomendado em produção)</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground">Timeout (ms)</Label>
                  <Input
                    type="number"
                    value={config.rpa_timeout_ms}
                    onChange={(e) => setConfig((p) => ({ ...p, rpa_timeout_ms: Number(e.target.value) }))}
                    className="bg-background border-border"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground">Tentativas por OS</Label>
                  <Input
                    type="number"
                    min={1} max={5}
                    value={config.rpa_tentativas}
                    onChange={(e) => setConfig((p) => ({ ...p, rpa_tentativas: Number(e.target.value) }))}
                    className="bg-background border-border"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground">Delay entre OS (ms)</Label>
                  <Input
                    type="number"
                    value={config.rpa_delay_entre_os_ms}
                    onChange={(e) => setConfig((p) => ({ ...p, rpa_delay_entre_os_ms: Number(e.target.value) }))}
                    className="bg-background border-border"
                  />
                </div>
                <div className="flex items-center gap-3 md:col-span-2 pt-2 border-t border-border">
                  <Switch
                    checked={config.rpa_debug_video}
                    onCheckedChange={(v) => setConfig((p) => ({ ...p, rpa_debug_video: v }))}
                  />
                  <div>
                    <Label className="text-xs font-medium text-muted-foreground">Gravar vídeo das execuções</Label>
                    <p className="text-[11px] text-muted-foreground">Salva um arquivo .webm de cada execução — útil para depurar o que aconteceu no servidor</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 md:col-span-2">
                  <Switch
                    checked={config.rpa_debug_trace}
                    onCheckedChange={(v) => setConfig((p) => ({ ...p, rpa_debug_trace: v }))}
                  />
                  <div>
                    <Label className="text-xs font-medium text-muted-foreground">Gravar trace detalhado (Playwright)</Label>
                    <p className="text-[11px] text-muted-foreground">Salva um arquivo .zip com screenshots, DOM e rede de cada ação — abrir com <code>playwright show-trace arquivo.zip</code></p>
                  </div>
                </div>
                {(config.rpa_debug_video || config.rpa_debug_trace) && (
                  <div className="md:col-span-2 rounded-md bg-yellow-500/10 border border-yellow-500/30 px-3 py-2 text-[11px] text-yellow-600">
                    Debug ativo — os arquivos ficam em <code>/runtime/debug_rpa/</code> no servidor. Acesse em{" "}
                    <a href="/api/automacao/debug/arquivos" target="_blank" className="underline font-medium">
                      /api/automacao/debug/arquivos
                    </a>{" "}
                    para listar e baixar. Desative quando não precisar mais para economizar espaço em disco.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* ── Salvar ── */}
          <div className="flex justify-end">
            <Button onClick={saveConfig} disabled={configSaving} className="gap-2">
              {configSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar Configurações
            </Button>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
