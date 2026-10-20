import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Aura Uncaught ErrorBoundary:", error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleResetCache = () => {
    try {
      sessionStorage.clear();
      localStorage.removeItem('aura_last_song');
      localStorage.removeItem('aura_recent');
    } catch {}
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 bg-[#050505] text-white flex flex-col items-center justify-center p-6 z-[9999] select-none font-sans">
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-6 text-red-400">
            <AlertTriangle size={32} />
          </div>

          <h1 className="text-xl sm:text-2xl font-bold tracking-tight mb-2 text-center">
            Ha ocurrido un problema al cargar la interfaz
          </h1>
          <p className="text-xs sm:text-sm text-white/50 max-w-md text-center mb-6 leading-relaxed">
            Se ha interceptado un error inesperado para evitar que la aplicación quede congelada.
          </p>

          {this.state.error && (
            <div className="w-full max-w-md p-3.5 rounded-2xl bg-white/5 border border-white/5 text-[11px] font-mono text-red-300/80 mb-6 overflow-x-auto whitespace-pre-wrap max-h-36">
              {this.state.error.message || String(this.state.error)}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 w-full max-w-xs">
            <button
              onClick={this.handleReload}
              className="flex-1 py-3 px-4 rounded-xl font-bold text-xs bg-brand-primary text-black hover:brightness-110 active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <RefreshCw size={14} />
              <span>Recargar Aura</span>
            </button>
            <button
              onClick={this.handleResetCache}
              className="py-3 px-4 rounded-xl font-semibold text-xs bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-all cursor-pointer"
            >
              Restablecer sesión
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
