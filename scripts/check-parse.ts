import { extractEmbeddedDataFromHtml, parseAgentCommentsFromResponseBody } from '../lib/niconamaCommentClient.helpers';

const embeddedHtml = '<script id="embedded-data" data-props="{&quot;site&quot;:{&quot;state&quot;:{&quot;relive&quot;:{}},&quot;program&quot;:{&quot;statistics&quot;:{&quot;commentCount&quot;:1}}}}"></script>';
const extracted = extractEmbeddedDataFromHtml(embeddedHtml);
console.log('extracted:', JSON.stringify(extracted));
const parsed = parseAgentCommentsFromResponseBody(extracted);
console.log('parsed length:', parsed.length);
console.log('parsed:', JSON.stringify(parsed, null, 2));
