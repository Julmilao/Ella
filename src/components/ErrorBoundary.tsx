import React from "react";
import { RefreshCw, AlertTriangle } from "lucide-react";

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10">
            <AlertTriangle className="h-7 w-7 text-destructive" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">Algo deu errado nesta página</h2>
            <p className="mt-1 text-sm text-muted-foreground max-w-sm">
              {this.state.error.message || "Erro inesperado no componente."}
            </p>
          </div>
          <button
            onClick={this.reset}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            Tentar novamente
          </button>
          <details className="mt-2 max-w-xl text-left">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
              Detalhes técnicos
            </summary>
            <pre className="mt-2 overflow-auto rounded-lg bg-muted p-3 text-[11px] text-muted-foreground">
              {this.state.error.stack}
            </pre>
          </details>
        </div>
      );
    }

    return this.props.children;
  }
}
