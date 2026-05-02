import { Link } from 'react-router-dom';
import './LegalScreen.css';

const LAST_UPDATED = 'May 2026';

function LegalLayout({ title, children }) {
  return (
    <div className="legal-bg">
      <div className="legal-card">
        <div className="legal-header">
          <Link to="/" className="legal-logo" aria-label="Back to Krytz">
            <span className="legal-logo-mark">✦</span>
            <span className="legal-logo-text">Krytz</span>
          </Link>
          <span className="legal-updated">Last updated: {LAST_UPDATED}</span>
        </div>
        <h1 className="legal-title">{title}</h1>
        <div className="legal-body">{children}</div>
        <div className="legal-footer">
          <Link to="/" className="legal-link">← Back to app</Link>
          <span className="legal-sep">·</span>
          <Link to="/privacy" className="legal-link">Privacy</Link>
          <span className="legal-sep">·</span>
          <Link to="/terms" className="legal-link">Terms</Link>
        </div>
      </div>
    </div>
  );
}

export function PrivacyScreen() {
  return (
    <LegalLayout title="Privacy Policy">
      <p>
        Krytz ("we", "our", or "us") respects your privacy. This Privacy Policy explains
        what information we collect when you use Krytz, how we use it, and the choices
        you have. By using Krytz you agree to the practices described here.
      </p>

      <h2>Information we collect</h2>
      <ul>
        <li><strong>Account information.</strong> When you sign up we collect your email
          address and, if you provide it, your name. If you sign in with Google we receive
          your email, name, and Google profile identifier.</li>
        <li><strong>Content you create.</strong> Notes, tasks, entries, and other content
          you store in Krytz are kept in our database under your account.</li>
        <li><strong>Usage and device data.</strong> We log basic technical information
          (IP address, browser type, request timestamps) to operate the service and
          investigate abuse.</li>
      </ul>

      <h2>How we use your information</h2>
      <ul>
        <li>To provide and operate the Krytz service.</li>
        <li>To authenticate you and keep your account secure.</li>
        <li>To send transactional messages (e.g. password reset, account verification).</li>
        <li>To understand how Krytz is used so we can improve it.</li>
      </ul>

      <h2>How we share information</h2>
      <p>
        We do not sell your personal data. We share information only with service
        providers we use to run Krytz (for example, our hosting and email providers),
        and only to the extent needed to provide the service. We may disclose
        information if required by law or to protect the safety of users.
      </p>

      <h2>Data retention</h2>
      <p>
        We keep your account and content for as long as your account is active. If you
        delete your account, we delete the associated personal data and content within
        30 days, except where we are required to retain records for legal reasons.
      </p>

      <h2>Your choices</h2>
      <ul>
        <li>You can update or delete your account at any time from Settings.</li>
        <li>You can request a copy of your data by contacting us.</li>
        <li>You can revoke Google access from your Google account permissions page.</li>
      </ul>

      <h2>Security</h2>
      <p>
        We use industry-standard practices to protect your data, including encrypted
        transport (TLS), hashed passwords, and access controls. No system is perfectly
        secure; we encourage you to use a strong, unique password.
      </p>

      <h2>Children</h2>
      <p>
        Krytz is not directed to children under 13. We do not knowingly collect personal
        information from children under 13.
      </p>

      <h2>Changes to this policy</h2>
      <p>
        We may update this policy from time to time. Material changes will be communicated
        through the app or by email when reasonably possible.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this policy? Email us at{' '}
        <a href="mailto:mail2piyushbatra@gmail.com">mail2piyushbatra@gmail.com</a>.
      </p>
    </LegalLayout>
  );
}

export function TermsScreen() {
  return (
    <LegalLayout title="Terms of Service">
      <p>
        These Terms of Service ("Terms") govern your use of Krytz. By creating an
        account or using Krytz you agree to these Terms.
      </p>

      <h2>Your account</h2>
      <p>
        You must provide accurate information when you sign up and keep your credentials
        confidential. You are responsible for activity under your account. If you suspect
        unauthorized access, contact us immediately.
      </p>

      <h2>Acceptable use</h2>
      <ul>
        <li>Don't use Krytz for anything illegal or to harm others.</li>
        <li>Don't attempt to disrupt the service or access other accounts.</li>
        <li>Don't reverse-engineer, scrape, or resell the service without permission.</li>
        <li>Don't upload content you don't have the right to share.</li>
      </ul>

      <h2>Your content</h2>
      <p>
        You keep ownership of the content you create in Krytz. You grant us a limited
        license to store, process, and display that content solely to operate the service
        for you. We don't claim rights to your content beyond what's needed to run Krytz.
      </p>

      <h2>Service availability</h2>
      <p>
        We work hard to keep Krytz running reliably, but we provide the service "as is"
        without warranties of any kind. We may change, suspend, or discontinue features
        with reasonable notice.
      </p>

      <h2>Termination</h2>
      <p>
        You may stop using Krytz at any time. We may suspend or terminate accounts that
        violate these Terms or pose a risk to other users.
      </p>

      <h2>Limitation of liability</h2>
      <p>
        To the fullest extent permitted by law, Krytz is not liable for indirect,
        incidental, or consequential damages arising from your use of the service. Our
        total liability is limited to the amounts you've paid us in the prior twelve
        months (if any).
      </p>

      <h2>Changes to these Terms</h2>
      <p>
        We may update these Terms from time to time. If we make material changes we'll
        notify you. Continued use of Krytz after changes take effect constitutes acceptance.
      </p>

      <h2>Governing law</h2>
      <p>
        These Terms are governed by the laws of India, without regard to conflict-of-laws
        rules. Disputes will be resolved in the courts of India.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these Terms? Email us at{' '}
        <a href="mailto:mail2piyushbatra@gmail.com">mail2piyushbatra@gmail.com</a>.
      </p>
    </LegalLayout>
  );
}
