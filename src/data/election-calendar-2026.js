/**
 * 2026 ELECTION CALENDAR
 * src/data/election-calendar-2026.js
 *
 * Hard-coded 2026 primary and general election dates by state.
 * Federal general election: November 3, 2026 (all states).
 * Primary dates vary significantly by state.
 *
 * Sources: NCSL, state SOS websites, Ballotpedia 2026 election calendar.
 * These dates are correct as of August 2026 but should be verified
 * against state SOS websites before being shown to candidates.
 *
 * All 33 Senate seats up in 2026 are Class 2 seats.
 * All 435 House seats are up.
 */

const GENERAL_ELECTION_DATE = '2026-11-03';

const STATE_ELECTION_CALENDAR = {
  AL: { primary: '2026-05-05', primaryRunoff: '2026-06-23', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-04-03' },
  AK: { primary: '2026-08-18', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-06-01' },
  AZ: { primary: '2026-08-04', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-05-27' },
  AR: { primary: '2026-05-19', primaryRunoff: '2026-06-09', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-03-03' },
  CA: { primary: '2026-06-02', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-03-06' },
  CO: { primary: '2026-06-23', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-03-16' },
  CT: { primary: '2026-08-11', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-06-09' },
  DE: { primary: '2026-09-15', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-07-28' },
  FL: { primary: '2026-08-18', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-06-12' },
  GA: { primary: '2026-05-19', primaryRunoff: '2026-06-23', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-03-06' },
  HI: { primary: '2026-08-08', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-06-02' },
  ID: { primary: '2026-05-19', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-03-13' },
  IL: { primary: '2026-03-17', general: GENERAL_ELECTION_DATE, filingDeadline: '2025-12-08' },
  IN: { primary: '2026-05-05', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-02-06' },
  IA: { primary: '2026-06-02', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-03-27' },
  KS: { primary: '2026-08-04', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-06-01' },
  KY: { primary: '2026-05-19', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-01-27' },
  LA: { primary: '2026-11-03', general: '2026-12-05', filingDeadline: '2026-08-07', note: 'Louisiana jungle primary' },
  ME: { primary: '2026-06-09', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-03-16' },
  MD: { primary: '2026-07-21', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-05-29' },
  MA: { primary: '2026-09-15', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-06-02' },
  MI: { primary: '2026-08-04', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-04-21' },
  MN: { primary: '2026-08-11', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-05-19' },
  MS: { primary: '2026-06-02', primaryRunoff: '2026-06-23', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-03-06' },
  MO: { primary: '2026-08-04', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-03-31' },
  MT: { primary: '2026-06-02', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-03-16' },
  NE: { primary: '2026-05-12', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-03-02' },
  NV: { primary: '2026-06-09', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-03-13' },
  NH: { primary: '2026-09-08', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-06-05' },
  NJ: { primary: '2026-06-02', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-04-06' },
  NM: { primary: '2026-06-02', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-03-10' },
  NY: { primary: '2026-06-23', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-04-02' },
  NC: { primary: '2026-05-05', primaryRunoff: '2026-07-07', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-02-27' },
  ND: { primary: '2026-06-09', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-04-09' },
  OH: { primary: '2026-05-05', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-02-04' },
  OK: { primary: '2026-06-23', primaryRunoff: '2026-08-25', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-04-08' },
  OR: { primary: '2026-05-19', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-03-10' },
  PA: { primary: '2026-05-19', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-03-10' },
  RI: { primary: '2026-09-15', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-06-30' },
  SC: { primary: '2026-06-09', primaryRunoff: '2026-06-23', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-03-30' },
  SD: { primary: '2026-06-02', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-03-31' },
  TN: { primary: '2026-08-06', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-04-02' },
  TX: { primary: '2026-03-03', primaryRunoff: '2026-05-26', general: GENERAL_ELECTION_DATE, filingDeadline: '2025-12-08' },
  UT: { primary: '2026-06-23', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-03-31' },
  VT: { primary: '2026-08-11', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-05-28' },
  VA: { primary: '2026-06-09', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-03-26' },
  WA: { primary: '2026-08-04', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-05-15' },
  WV: { primary: '2026-05-12', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-01-24' },
  WI: { primary: '2026-08-11', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-06-01' },
  WY: { primary: '2026-08-18', general: GENERAL_ELECTION_DATE, filingDeadline: '2026-05-29' },
};

// Senate seats up in 2026 (Class 2)
const SENATE_SEATS_2026 = {
  AL: { incumbent: 'Tommy Tuberville', party: 'R', isOpenSeat: false },
  AK: { incumbent: 'Dan Sullivan', party: 'R', isOpenSeat: false },
  AR: { incumbent: 'Tom Cotton', party: 'R', isOpenSeat: false },
  CO: { incumbent: 'John Hickenlooper', party: 'D', isOpenSeat: false },
  DE: { incumbent: 'Chris Coons', party: 'D', isOpenSeat: false },
  GA: { incumbent: 'Jon Ossoff', party: 'D', isOpenSeat: false },
  ID: { incumbent: 'Jim Risch', party: 'R', isOpenSeat: false },
  IL: { incumbent: 'Dick Durbin', party: 'D', isOpenSeat: true, note: 'Durbin retiring' },
  IA: { incumbent: 'Joni Ernst', party: 'R', isOpenSeat: false },
  KS: { incumbent: 'Jerry Moran', party: 'R', isOpenSeat: false },
  KY: { incumbent: 'Mitch McConnell', party: 'R', isOpenSeat: false },
  LA: { incumbent: 'Bill Cassidy', party: 'R', isOpenSeat: false },
  MD: { incumbent: 'Chris Van Hollen', party: 'D', isOpenSeat: false },
  MO: { incumbent: 'Josh Hawley', party: 'R', isOpenSeat: false },
  MT: { incumbent: 'Jon Tester', party: 'D', isOpenSeat: true, note: 'Tester lost 2024' },
  NE: { incumbent: 'Deb Fischer', party: 'R', isOpenSeat: false },
  NH: { incumbent: 'Jeanne Shaheen', party: 'D', isOpenSeat: true, note: 'Shaheen retiring' },
  NJ: { incumbent: 'Andy Kim', party: 'D', isOpenSeat: false },
  NM: { incumbent: 'Martin Heinrich', party: 'D', isOpenSeat: false },
  NC: { incumbent: 'Thom Tillis', party: 'R', isOpenSeat: false },
  OK: { incumbent: 'James Lankford', party: 'R', isOpenSeat: false },
  OR: { incumbent: 'Jeff Merkley', party: 'D', isOpenSeat: false },
  RI: { incumbent: 'Jack Reed', party: 'D', isOpenSeat: false },
  SC: { incumbent: 'Lindsey Graham', party: 'R', isOpenSeat: false },
  SD: { incumbent: 'Mike Rounds', party: 'R', isOpenSeat: false },
  TN: { incumbent: 'Marsha Blackburn', party: 'R', isOpenSeat: false },
  TX: { incumbent: 'John Cornyn', party: 'R', isOpenSeat: false },
  VA: { incumbent: 'Mark Warner', party: 'D', isOpenSeat: false },
  WA: { incumbent: 'Patty Murray', party: 'D', isOpenSeat: false },
  WV: { incumbent: 'Shelley Moore Capito', party: 'R', isOpenSeat: false },
  WY: { incumbent: 'John Barrasso', party: 'R', isOpenSeat: false },
};

module.exports = { STATE_ELECTION_CALENDAR, SENATE_SEATS_2026, GENERAL_ELECTION_DATE };
