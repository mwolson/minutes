// minutes-sdk — conversation memory for AI agents
//
// The "Mem0 for human conversations." Query meeting transcripts,
// decisions, action items, and people from any AI agent or app.
//
// Usage:
//   import { listMeetings, searchMeetings } from 'minutes-sdk';
//
//   const meetings = await listMeetings('~/meetings');
//   const results = await searchMeetings('~/meetings', 'pricing');

export {
  // Types
  type ActionItem,
  type Decision,
  type Intent,
  type Frontmatter,
  type MeetingFile,

  // Parsing
  splitFrontmatter,
  parseFrontmatter,

  // Query API
  listMeetings,
  searchMeetings,
  getMeeting,
  findOpenActions,
  getPersonProfile,
} from "./reader.js";
