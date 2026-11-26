import { Link } from 'react-router-dom';
import { StatePanel } from '../components/StatePanel';

export function NotFoundPage() {
  return (
    <section aria-labelledby="page-title">
      <header className="page-head">
        <h1 id="page-title">Page not found</h1>
      </header>
      <div className="panel">
        <StatePanel
          title="That page doesn't exist"
          description="The link may be out of date."
          action={
            <Link className="btn btn-primary" to="/">
              Back to the conversation
            </Link>
          }
        />
      </div>
    </section>
  );
}
