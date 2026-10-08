import { PageHead, StatePanel } from '../components/bits';
import { Icon } from '../components/Icon';

export function StubPage({ title, text, link, kind = 'elsewhere', heading }: {
  title: string;
  text?: string;
  link?: { href: string; label: string };
  kind?: string;
  heading?: string;
}) {
  const act = link ? <a className="btn" href={link.href} target="_blank" rel="noopener">{link.label}<Icon name="external" size={14} /></a> : null;
  return (
    <>
      <PageHead title={title} extra={act} pill={false} />
      <StatePanel kind={kind} title={heading || 'This lives in Blackboard'} detail={text || 'This dashboard does not pull this page.'} />
    </>
  );
}

export function ErrorPage({ message }: { message: string }) {
  return (
    <>
      <PageHead title="Could not render cached data" pill={false} />
      <div className="card error-card">
        <Icon name="alert" size={22} />
        <div>
          <p><strong>{message}</strong></p>
          <p>The dashboard only renders data stored by the extension's content scripts. Try reloading this page, or open the Diagnostics page.</p>
        </div>
      </div>
    </>
  );
}
