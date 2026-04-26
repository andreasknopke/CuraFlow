import React from 'react';
import { AlertTriangle, Bug } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * ErrorBoundary – fängt unbehandelte React-Fehler ab
 * und zeigt einen Dialog an, um einen automatischen Bug-Report zu erstellen.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error('[ErrorBoundary] Unbehandelter Fehler:', error, errorInfo);
  }

  handleReportBug = () => {
    // TicketDialog öffnen – wir setzen ein Flag im window, das der Dialog ausliest
    window.__openTicketDialog?.('bug', this.state.error);
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      // Falls ein onError-Callback gesetzt ist, rufe ihn auf
      if (this.props.onError) {
        this.props.onError(this.state.error);
      }

      // Falls ein Fallback-UI direkt übergeben wurde
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-8">
          <div className="max-w-md w-full bg-white rounded-xl shadow-lg border border-slate-200 p-8 text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="h-8 w-8 text-red-500" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">Ein Fehler ist aufgetreten</h2>
            <p className="text-sm text-slate-600 mb-6">
              Entschuldigung, es gab einen unerwarteten Fehler. 
              Sie können einen Bug-Report senden, damit wir das Problem beheben können.
            </p>

            {this.state.error && (
              <details className="mb-6 text-left">
                <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600">
                  Technische Details anzeigen
                </summary>
                <pre className="mt-2 p-3 bg-slate-100 rounded-lg text-xs text-slate-700 overflow-auto max-h-40">
                  {this.state.error.message}
                  {'\n\n'}
                  {this.state.error.stack}
                </pre>
              </details>
            )}

            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button variant="outline" onClick={this.handleReload}>
                Neu laden
              </Button>
              <Button onClick={this.handleReportBug}>
                <Bug className="mr-2 h-4 w-4" />
                Bug-Report senden
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
