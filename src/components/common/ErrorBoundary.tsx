import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(_: Error): State {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo, callback: () => void) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);

    // Si el error es un fallo de carga de chunk, intentamos recargar la página
    if (error.message.includes('Failed to fetch dynamically imported module') ||
        error.message.includes('Loading chunk')) {
      window.location.reload();
    }

    callback();
  }

  public render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div style={{
          padding: '20px',
          color: 'white',
          textAlign: 'center',
          backgroundColor: 'rgba(0,0,0,0.8)',
          borderRadius: '12px',
          margin: '20px'
        }}>
          <h3>Algo salió mal al cargar este módulo</h3>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: '10px',
              padding: '8px 16px',
              cursor: 'pointer',
              backgroundColor: '#6366f1',
              color: 'white',
              border: 'none',
              borderRadius: '6px'
            }}
          >
            Reintentar
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
