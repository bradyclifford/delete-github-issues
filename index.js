import prompts from "prompts";
import { Octokit } from "@octokit/core";
import { paginateGraphQL } from "@octokit/plugin-paginate-graphql";
const MyOctokit = Octokit.plugin(paginateGraphQL);

const questions = [
  {
    type: 'password',
    name: 'token',
    message: 'What is your GitHub Personal Access Token?',
    validate: x => x.length > 0 || 'Token is required',
    initial: process.env.GITHUB_TOKEN
  },
  {
    type: 'text',
    name: 'owner',
    message: 'What is the owner of the repo where the issues reside?',
    validate: x => x.length > 0 || 'Owner is required',
    initial: process.env.GITHUB_REPOSITORY?.split('/')[0]
  },
  {
    type: 'text',
    name: 'repo',
    message: 'What is the name of the repo where the issues reside?',
    validate: x => x.length > 0 || 'Repo is required',
    initial: process.env.GITHUB_REPOSITORY?.split('/')[1]
  },
  {
    type: 'text',
    name: 'label',
    message: 'What label should the issues have to be deleted?',
    initial: 'deployment-board',
    validate: x => x.length > 0 || 'Label is required'
  }
];

function onCancel() {
  console.warn('Aborted');
  process.exit(1);
}

const props = await prompts(questions, { onCancel });

const octokit = new MyOctokit({ auth: props.token });
const { repository } = await octokit.graphql.paginate(
  `
    query allIssues($owner: String!, $repo: String!, $num: Int = 10, $cursor: String) {
      repository(owner: $owner, name: $repo) {
        issues(first: $num, after: $cursor, filterBy: { labels: ["${props.label}"] }) {
          edges {
            node {
              id
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  `,
  {
    owner: props.owner,
    repo: props.repo
  }
);

const issues = repository.issues.edges.map(({ node }) => node.id);
if (issues.length === 0) {
  console.warn(`No issues with label '${props.label}' found. Nothing to delete.`);
  process.exit(1);
}

const confirmation = await prompts([{
  type: 'confirm',
  name: 'value',
  message: `Confirm the deletion of ${issues.length} issues in ${props.owner}/${props.repo} with label ${props.label}?`
}], { onCancel });

if (!confirmation.value) {
  console.warn('Abort deletion of issues');
  process.exit(1);
}

// TODO: work through a batch of issues at a time
for await (const id of issues) {
  await octokit.graphql(
    `
      mutation deleteIssue($id: ID!) {
        deleteIssue(input: { issueId: $id }) {
          clientMutationId
        }
      }
    `,
    { id }
  );
  console.info(`Issue ${id} deleted`);
};

console.log('---------');
console.info(`All issues with label '${props.label}' have been deleted from ${props.owner}/${props.repo}`);
