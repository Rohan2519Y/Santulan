/*
 * Picture paths for every photo / illustration on the site. Every slot is an empty white area until a path is filled in here.
 *
 * How to fill one in:
 *   1. Put the file under frontend/public/images/ (for example frontend/public/images/home-hero.jpg).
 *   2. Write its URL between the quotes below:  homeHero: '/images/home-hero.jpg',
 *   3. For a different picture on phones, use an object:  homeHero: { desktop: '/images/home.jpg', mobile: '/images/home-mobile.jpg' },
 *      The mobile picture is used below 640 px wide.
 *
 * An empty string keeps the white placeholder, so nothing else has to change. Pictures are decorative, so they carry no alt text
 * unless you pass `alt` where the slot is used.
 */
export const IMAGE_SLOTS = {
  // Brand
  logoMark: '/logoMark.png',            // the lotus mark shown beside the SANTULAN wordmark (header, footer, sidebar)
  leafArt: '',             // soft leaf illustration at the bottom-left of the sidebar and behind the route page title

  // Public pages
  homeHero: '',            // screen 01: photo on the right of the home hero (phones: the splash picture)
  aboutHero: '',           // screen 02: photo of three students on the right of the about hero
  registerStep1: '',       // screen 04: person on a ledge
  registerStep2: '',       // screen 05: desk with books and a mug
  registerStep3: '',       // screen 06: person with a backpack
  registerStep4: '',       // screen 07: person looking at the view
  registerStep5: '',       // screen 08: books and a plant
  loginHero: '',           // screen 09: building with trees

  // Signed-in pages
  dashboardHero: '',       // screen 10: person with a backpack at the top-right of the dashboard
  assessmentHero: '',      // screen 11: illustration beside the assessment heading
  completeHero: '',        // screen 16: celebrating illustration
  generatingPhoto: '',     // screen 17: photo at the top of the right column
  generatingArt: '',       // screen 17: document and magnifier illustration in the middle
  thanksBanner: '',        // screen 19: sign-post landscape banner
  thanksPhoto: '',         // screen 19: photo at the top of the right column
  profileHero: '',         // screen 20: illustration at the top of the right column
  preferencesHero: '',     // screen 22
  privacyHero: '',         // screen 24
  resultsHero: '',         // results page header picture
};
