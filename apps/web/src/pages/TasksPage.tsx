import { StatePanel } from '../components/StatePanel';

export function TasksPage() {
  return (
    <section aria-labelledby="page-title">
      <header className="page-head">
        <h1 id="page-title">Tasks</h1>
      </header>
      <div className="panel">
        <StatePanel title="No tasks yet" description="Tasks and projects aren't available yet." />
      </div>
    </section>
  );
}
