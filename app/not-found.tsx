import Link from "next/link";

export default function NotFound() {
  return (
    <section className="card">
      <h1>Page not found</h1>
      <p className="note"><Link href="/">Back to Today</Link></p>
    </section>
  );
}
