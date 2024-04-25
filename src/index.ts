import { getInput, setFailed, startGroup, info, endGroup, setOutput } from '@actions/core';
import { context, getOctokit,  } from '@actions/github';
import { getVersion, getCommitLog, defaultTypes, formatStringCommit, getRegExp } from './utils';

const regexp = /^[.A-Za-z0-9_-]*$/;

const getOptions = () => {
  const myToken = getInput('token');
  return {
    ...context.repo,
    headRef: getInput('head-ref'),
    baseRef: getInput('base-ref'),
    myToken,
    myPath: getInput('path'),
    order: getInput('asc') as 'asc' | 'desc',
    template: getInput('template'),
    /** @example `type🆎,chore💄,fix🐞` Use commas to separate */
    customEmoji: getInput('custom-emoji') || '',
    showEmoji: getInput('show-emoji') === 'false' ? false : true,
    removeType: getInput('remove-type') === 'false' ? false : true,
    filterAuthor: getInput('filter-author'),
    regExp: getInput('filter'),
    ghPagesBranch: getInput('gh-pages') || 'gh-pages',
    originalMarkdown: getInput('original-markdown'),
    octokit: getOctokit(myToken),
    types: defaultTypes,
  }
}


async function run() {
  try {
    const options = getOptions();
    const {
      myPath,
      template,
      customEmoji,
      removeType,
      showEmoji,
      filterAuthor,
      regExp,
      ghPagesBranch,
      originalMarkdown,
      owner,
      repo,
      octokit,
      types,
    } = options || {};
    
    const customEmojiData = customEmoji.split(',')
    if (customEmoji && customEmojiData.length) {
      customEmojiData.forEach((item) => {
        const emojiIcon = item.match(/[\u{1F300}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F1E0}-\u{1F1FF}]/gu);
        const typeName = item.replace(/[\u{1F300}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F1E0}-\u{1F1FF}]/gu, '');
        if (typeName && emojiIcon) {
          types[typeName as keyof typeof types] = emojiIcon[0];
        }
      });
    }

    if (!options.baseRef) {
      const latestRelease = await octokit.rest.repos.getLatestRelease({ ...context.repo });
      if (latestRelease.status !== 200) {
        setFailed(
          `There are no releases on ${owner}/${repo}. Tags are not releases. (status=${latestRelease.status}) ${(latestRelease.data as any).message || ''}`
        );
      }
      options.baseRef = latestRelease.data.tag_name;
      startGroup(
        `Latest Release Result Data: \x1b[32m${latestRelease.status || '-'}\x1b[0m \x1b[32m${latestRelease.data.tag_name}\x1b[0m`
      )
      info(`${JSON.stringify(latestRelease, null, 2)}`)
      endGroup()
    }
    if (!options.headRef) {
      options.headRef = context.sha;
    }

    info(`Commit Content: \x1b[34m${owner}/${repo}\x1b[0m`)
    startGroup(`Ref: \x1b[34m${context.ref}\x1b[0m`);
    info(`${JSON.stringify(context, null, 2)}`);
    endGroup();

    let tagRef = '';
    if ((context.ref || '').startsWith('refs/tags/')) {
      tagRef = getVersion(context.ref);
    }

    if ((context.ref || '').startsWith('refs/heads/')) {
      const branch = context.ref.replace(/.*(?=\/)\//, '');
      setOutput('branch', branch);
      info(`Branch: \x1b[34m${branch}\x1b[0m`);
    }
    info(`Ref: baseRef(\x1b[32m${options.baseRef}\x1b[0m), options.headRef(\x1b[32m${options.headRef}\x1b[0m), tagRef(\x1b[32m${tagRef}\x1b[0m)`);

    try {
      const branchData = await octokit.request('GET /repos/{owner}/{repo}/branches', { ...context.repo });
      const ghPagesData = branchData.data.find((item) => item.name === ghPagesBranch);
      startGroup(`\x1b[34mGet Branch \x1b[0m`);
      info(`Branch Data: ${JSON.stringify(branchData.data, null, 2)}`);
      if (ghPagesData) {
        info(`ghPages Data: ${ghPagesBranch}, ${ghPagesData.commit.sha}, ${JSON.stringify(ghPagesData, null, 2)}`);
      }
      endGroup();
      if (ghPagesData) {
        setOutput('gh-pages-hash', ghPagesData.commit.sha);
        setOutput('gh-pages-short-hash', ghPagesData.commit.sha.substring(0,7));
      }
    } catch (error) {
      if (error instanceof Error) {
        info(`Get Branch: \x1b[33m${error.message}\x1b[0m`);
      }
    }

    if ((options.baseRef || '').replace(/^[vV]/, '') === options.headRef) {
      setOutput('tag', options.baseRef);
      setOutput('version', options.baseRef.replace(/^[vV]/, ''));
      info(`Done: baseRef(\x1b[33m${options.baseRef}\x1b[0m) === headRef(\x1b[32m${options.headRef}\x1b[0m)`);
      return;
    }

    if (
      !!options.headRef &&
      !!options.baseRef &&
      regexp.test(options.headRef) &&
      regexp.test(options.baseRef)
    ) {
      let resultData = [] as Commits[]
      if (myPath) {
        info(`path: ${myPath}`)
        const commitsData = await octokit.request('GET /repos/{owner}/{repo}/commits', {
          ...context.repo,
          path: myPath,
        })

        if (commitsData && commitsData.status !== 200) {
          setFailed(
            `There are no releases on ${owner}/${repo}. Tags are not releases. (status=${commitsData.status}) ${(commitsData.data as any).message || ''}`
          );
        } else {
          resultData = commitsData.data as unknown  as Commits[];
        }
        startGroup(
          `Compare Path Commits Result Data: \x1b[32m${commitsData.status || '-'}\x1b[0m \x1b[32m${options.baseRef}\x1b[0m...\x1b[32m${options.headRef}\x1b[0m`
        )
        info(`${JSON.stringify(commitsData.data, null, 2)}`)
        endGroup()
      } else {
        const commitsData = await octokit.rest.repos.compareCommits({
          ...context.repo,
          base: options.baseRef,
          head: options.headRef,
        });
  
        if (commitsData && commitsData.status !== 200) {
          setFailed(
            `There are no releases on ${owner}/${repo}. Tags are not releases. (status=${commitsData.status}) ${(commitsData.data as any).message || ''}`
          );
        } else {
          resultData = commitsData.data.commits as unknown  as Commits[]
        }
        startGroup(
          `Compare Commits Result Data: \x1b[32m${commitsData.status || '-'}\x1b[0m \x1b[32m${options.baseRef}\x1b[0m...\x1b[32m${options.headRef}\x1b[0m`
        )
        info(`${JSON.stringify(commitsData, null, 2)}`)
        endGroup()
      }

      let commitLog = [];
      info(`ResultData Lenght:${resultData.length} - ${options.order}`)
      for (const data of resultData) {
        const message = data.commit.message.split('\n\n')[0];
        const author = data.author || data.committer || { login: '-' };
        startGroup(`Commit: \x1b[34m${message}\x1b[0m \x1b[34m${(data.commit.author || {}).name}(${author.login})\x1b[0m ${data.sha}`);
        info(`${JSON.stringify(data, null, 2)}`);
        endGroup();
        commitLog.push(formatStringCommit(message, `${owner}/${repo}`, {
          originalMarkdown,
          regExp, shortHash: data.sha.slice(0, 7), filterAuthor, hash: data.sha,
          // author: '',
          // author: data.commit.author ? data.commit.author.name : '',
          login: author.login,
        }));
      }

      commitLog = options.order === 'asc' ? commitLog : commitLog.reverse();

      if (!tagRef) {
        const listTags = await octokit.rest.repos.listTags({ owner, repo });
        if (listTags.status !== 200) {
          setFailed(`Failed to get tag lists (status=${listTags.status})`);
          return
        }
        tagRef = listTags.data[0] && listTags.data[0].name ? listTags.data[0].name : '';
      }

      const { changelog, changelogContent } = getCommitLog(commitLog, { types, showEmoji, removeType, template });
      startGroup('Result Changelog');
      info(`${changelog.join('\n')}`);
      endGroup();
      setOutput('changelog', changelogContent);

      info(`Tag: \x1b[34m${tagRef}\x1b[0m`);
      setOutput('tag', tagRef);

      info(`Tag: \x1b[34m${tagRef || options.headRef || '-'}\x1b[0m`);
      info(`Input head-ref: \x1b[34m${options.headRef}\x1b[0m`);
      info(`Input base-ref: \x1b[34m${options.baseRef}\x1b[0m`);
      setOutput('compareurl', `https://github.com/${owner}/${repo}/compare/${options.baseRef}...${tagRef || options.headRef}`);
      setOutput('version', getVersion(tagRef || options.headRef || '').replace(/^v/, ''));
    } else {
      setFailed(
        'Branch names must contain only numbers, strings, underscores, periods, and dashes.'
      );
    }
  } catch (error) {
    info(`path: ${error}`);
    startGroup(`Error: \x1b[34m${(error as any).message || error}\x1b[0m`);
    info(`${JSON.stringify(error, null, 2)}`);
    endGroup();
    if (error instanceof Error) {
      setFailed(
        `Could not generate changelog between references because: ${error.message}`
      );
    }
    process.exit(1);
  }
}

try {
  run();
} catch (error) {
  if (error instanceof Error) {
    setFailed(error.message);
  }
}
