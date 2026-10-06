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
  logoMark: '/images/logoMark.png',            // the lotus mark shown beside the SANTULAN wordmark (header, footer, sidebar)
  leafArt: '/images/leafArt.png',             // soft leaf illustration at the bottom-left of the sidebar and behind the route page title

  // Public pages
  homeHero: '/images/homeHero.png',            // screen 01: photo on the right of the home hero (phones: the splash picture)
  aboutHero: '/images/aboutHero.png',           // screen 02: photo of three students on the right of the about hero
  registerStep1: '/images/registerStep1.png',       // screen 04: person on a ledge
  registerStep2: '/images/registerStep2.png',       // screen 05: desk with books and a mug
  registerStep3: '/images/registerStep3.png',       // screen 06: person with a backpack
  registerStep4: '/images/registerStep4.png',       // screen 07: person looking at the view
  registerStep5: '/images/registerStep5.png',       // screen 08: books and a plant
  loginHero: '/images/loginHero.png',           // screen 09: building with trees
  forgotPasswordHero: '/images/forgotPasswordHero.png', // password reset page: campus study space

  // Signed-in pages
  dashboardHero: '/images/dashboardHero.png',       // screen 10: person with a backpack at the top-right of the dashboard
  assessmentHero: '/images/assessmentHero.png',      // screen 11: illustration beside the assessment heading
  completeHero: '/images/completeHero.png',        // screen 16: celebrating illustration
  generatingPhoto: '/images/generatingPhoto.png',     // screen 17: photo at the top of the right column
  generatingArt: '/images/generatingArt.png',       // screen 17: document and magnifier illustration in the middle
  thanksBanner: '/images/thanksBanner.png',        // screen 19: sign-post landscape banner
  thanksPhoto: '/images/thanksPhoto.png',         // screen 19: photo at the top of the right column
  profileHero: '/images/profileHero.png',         // screen 20: illustration at the top of the right column
  preferencesHero: '/images/preferencesHero.png',     // screen 22
  privacyHero: '/images/privacyHero.png',         // screen 24
  resultsHero: '/images/resultsHero.png',         // results page header picture
};
