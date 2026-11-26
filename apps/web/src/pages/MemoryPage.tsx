import { StatePanel } from '../components/StatePanel';

export function MemoryPage() {
  return (
    <section aria-labelledby="page-title">
      <header className="page-head">
        <h1 id="page-title">Memory</h1>
      </header>
      <div className="panel">
        <StatePanel title="Nothing remembered yet" description="Long-term memory isn't built yet, so nothing is being saved." />
      </div>
    </section>
  );
}
