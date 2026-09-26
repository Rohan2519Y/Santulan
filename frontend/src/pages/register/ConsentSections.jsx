import cs from './ConsentFormModal.module.css';

/** The approved consent document's body (heading + numbered sections), shared by the registration-time popup
 * (ConsentFormModal) and the self-service consent screen (participant profile) so both ever show the same wording. */
export default function ConsentSections({ copy }) {
  return (
    <>
      <h3 className={cs.heading}>{copy.heading}</h3>
      {copy.sections.map((sec) => (
        <section key={sec.title} className={cs.section}>
          <h4 className={cs.sectionTitle}>{sec.title}</h4>
          {sec.paragraphs.map((para) => <p key={para} className={cs.paragraph}>{para}</p>)}
          {sec.bullets && (
            <ul className={cs.bullets}>
              {sec.bullets.map((b) => <li key={b}>{b}</li>)}
            </ul>
          )}
          {sec.after && sec.after.map((para) => <p key={para} className={cs.paragraph}>{para}</p>)}
        </section>
      ))}
    </>
  );
}
