/** Overlay only the three pinned operators' presentation metadata on an older
 * audio index. A normal refresh and the scoped installer use the same mapping. */
export function operatorAudioIndexes(audioData, charword, scoped) {
  const names = new Set(scoped.audioData.soundFXBanks.map(b => b.name));
  return {
    audioData: { ...audioData, soundFXBanks: [...(audioData.soundFXBanks || []).filter(b => !names.has(b.name)), ...scoped.audioData.soundFXBanks],
      bankAlias: { ...audioData.bankAlias, ...scoped.audioData.bankAlias } },
    charword: { ...charword, charWords: { ...charword.charWords, ...scoped.charword.charWords }, voiceLangDict: { ...charword.voiceLangDict, ...scoped.charword.voiceLangDict },
      voiceLangTypeDict: { ...charword.voiceLangTypeDict, ...scoped.charword.voiceLangTypeDict } },
  };
}
