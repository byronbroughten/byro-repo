// A `git` call's verb, read past its global options, for the tier gate's push detection.
export class GitCall {
  readonly verb: string;

  private constructor(verb: string) {
    this.verb = verb;
  }

  static init(words: string[]): GitCall | undefined {
    if (words[0] !== "git") return undefined;
    for (let i = 1; i < words.length; i++) {
      const word = words[i] ?? "";
      if (optionsWithValue.has(word)) i++;
      else if (!word.startsWith("-")) return new GitCall(word);
    }
    return undefined;
  }
}

// The global options whose value comes as the next word, which would otherwise be taken for the verb.
const optionsWithValue = new Set(["-C", "--git-dir", "--work-tree", "-c"]);
