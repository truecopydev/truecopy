import { describe, expect, it } from 'vitest';
import {
	anchoredPassage,
	foldAnchor,
	missingFigures,
	proofSpan,
	type PassageOptions
} from './anchor.js';

/*
 * The cases below are the failures two applications measured on real corpora,
 * each pinned where it was first read wrongly: a paragraph quoted without the
 * clause that says who it applies to, a heading quoted without the list it
 * announces, a neighbour's figure inside a citation, and a value whose anchor
 * still falls on a sentence that says something else entirely.
 */

const DASHES: PassageOptions = { units: 'lines', depth: 'dashes' };
const PROSE: PassageOptions = { units: 'prose', depth: 'outline' };

/** One to nine, as a regulation writes them when the number is small. */
const SPELLED = new Map([
	['un', '1'],
	['une', '1'],
	['deux', '2'],
	['dix', '10']
]);

describe('foldAnchor', () => {
	it('folds the apostrophes and the dashes one document writes both ways', () => {
		expect(foldAnchor('l’unite fonciere')).toBe("l'unite fonciere");
		expect(foldAnchor('de 3 \u2013 6 metres')).toBe('de 3 - 6 metres');
		expect(foldAnchor('de 3 \u2014 6 metres')).toBe('de 3 - 6 metres');
	});

	it('folds neither case nor accents', () => {
		// A short anchor folded on accents matches in two places, and the second
		// place is another rule.
		expect(foldAnchor('Zone UA reservee')).toBe('Zone UA reservee');
	});

	it('keeps the line breaks the source printed', () => {
		expect(foldAnchor('- pour les ETAM  \n  -- deux mois', DASHES)).toBe(
			'- pour les ETAM\n-- deux mois'
		);
	});

	it('drops them on a blob, where a break is the page width and not the structure', () => {
		expect(foldAnchor('une bande\nde terrain', PROSE)).toBe('une bande de terrain');
	});
});

describe('anchoredPassage, on a source that marks its depth', () => {
	const notice = [
		"Les durees suivantes s'appliquent en cas de licenciement ou de demission :",
		'- pour les ETAM',
		"-- de moins de 2 ans d'anciennete : 1 mois",
		'-- de plus de 2 ans : 2 mois'
	].join('\n');

	it('brings back the two clauses that make the rule', () => {
		// Quoted alone, "de moins de 2 ans : 1 mois" reads as everyone's notice
		// period: it has lost who it applies to AND what it is a period of.
		expect(anchoredPassage(notice, "de moins de 2 ans d'anciennete", DASHES)).toEqual({
			heading: [
				"Les durees suivantes s'appliquent en cas de licenciement ou de demission :",
				'- pour les ETAM'
			],
			line: "-- de moins de 2 ans d'anciennete : 1 mois",
			opened: []
		});
	});

	it('never quotes a heading alone: the list it opens comes with it', () => {
		const passage = anchoredPassage(notice, 'pour les ETAM', DASHES);
		expect(passage?.opened).toEqual([
			"-- de moins de 2 ans d'anciennete : 1 mois",
			'-- de plus de 2 ans : 2 mois'
		]);
	});

	it('ranks a spaced pair of hyphens below a single one', () => {
		// The same agreement writes "--" in one article and "- -" in another. Read
		// as one run, the second ranks level with the line that carries it, the
		// parent stops climbing, and the passage says how much without saying for
		// whom.
		const text = ['- concernant les ETAM', "- - pour une anciennete jusqu'a 10 ans"].join('\n');
		expect(anchoredPassage(text, "jusqu'a 10 ans", DASHES)?.heading).toEqual([
			'- concernant les ETAM'
		]);
	});

	it('gives a top-level paragraph no heading: what precedes it is another rule', () => {
		expect(anchoredPassage(notice, 'Les durees suivantes', DASHES)?.heading).toEqual([]);
	});

	it('says nothing when the anchor no longer falls', () => {
		// The alarm of a revised document, and it is not an error.
		expect(anchoredPassage(notice, 'de moins de 3 ans', DASHES)).toBeNull();
		expect(anchoredPassage(notice, '', DASHES)).toBeNull();
	});
});

describe('anchoredPassage, on a blob that marks nothing', () => {
	const article =
		"1.1- Dans une bande de terrain d'une profondeur de 15 metres : " +
		'- zone UA : 9 metres. - secteur UAa : 12 metres.';

	it('quotes the numbered clause the bullet depends on', () => {
		expect(anchoredPassage(article, 'secteur UAa', PROSE)).toEqual({
			heading: ["1.1- Dans une bande de terrain d'une profondeur de 15 metres :"],
			line: '- secteur UAa : 12 metres.',
			opened: []
		});
	});

	it('leaves the neighbour out, figure and all', () => {
		// Quoting the paragraph beside it puts the next sector's twelve metres
		// inside the citation of a nine, and nothing says which one is proved.
		const passage = anchoredPassage(article, 'zone UA :', PROSE);
		expect(passage?.line).toBe('- zone UA : 9 metres.');
		expect(passage?.opened).toEqual([]);
	});

	it('passes a colon above what it announces, whatever its own shape', () => {
		const text = 'La hauteur est fixee a : - 7 metres en zone UA - 9 metres en zone UB';
		expect(anchoredPassage(text, 'La hauteur est fixee', PROSE)?.opened).toEqual([
			'- 7 metres en zone UA',
			'- 9 metres en zone UB'
		]);
	});

	it('lifts a bullet that announces above the bullets it announces', () => {
		// One planning code opens its article on a bullet, "Dans tous les secteurs
		// :", followed by two bullets of the same rank: without this the two
		// distances quote without the only clause that says where they apply.
		const text = '- Dans tous les secteurs : - 3 metres des limites - 5 metres de la voie';
		expect(anchoredPassage(text, '3 metres des limites', PROSE)?.heading).toEqual([
			'- Dans tous les secteurs :'
		]);
		expect(anchoredPassage(text, 'Dans tous les secteurs', PROSE)?.opened).toEqual([
			'- 3 metres des limites',
			'- 5 metres de la voie'
		]);
	});

	it('cuts a sentence off from the next one, figure and all', () => {
		const text = 'La hauteur est limitee a 9 metres. Les clotures sont libres.';
		expect(anchoredPassage(text, 'Les clotures', PROSE)?.line).toBe('Les clotures sont libres.');
	});

	it('reads the depth before the mute glyph goes, not after', () => {
		// A bullet in a substituted font reaches the text layer as a private-use
		// glyph. Stripped first, its line looks like a closed sentence, so it
		// heads nothing and loses the clause that fixes what it is.
		const text = 'La hauteur est fixee a : \u{E000} soit 7 metres sans depasser un etage';
		const passage = anchoredPassage(text, 'soit 7 metres', PROSE);
		expect(passage?.heading).toEqual(['La hauteur est fixee a :']);
		expect(passage?.line).toBe('soit 7 metres sans depasser un etage');
	});

	it('does not take the full stop of a number for a sentence end', () => {
		// Cut there, the number leaves in a paragraph of its own and the passage
		// opens on "En bordure", having lost which paragraph it comes from.
		expect(anchoredPassage('1.2. En bordure des autres voies', 'En bordure', PROSE)?.line).toBe(
			'1.2. En bordure des autres voies'
		);
	});

	it('does not take an initial for one either', () => {
		const text = 'Voir article R. Les hauteurs sont limitees a 9 metres.';
		expect(anchoredPassage(text, 'Les hauteurs', PROSE)?.line).toBe(text);
	});

	it('stops the climb at a closed sentence, which heads nothing', () => {
		const text = 'Les cloture sont libres. - zone UA : 9 metres.';
		expect(anchoredPassage(text, 'zone UA', PROSE)?.heading).toEqual([]);
	});
});

describe('missingFigures', () => {
	it('says nothing when the source carries what the value announces', () => {
		expect(missingFigures('hauteur maximale de 9 metres', '9 m')).toEqual([]);
	});

	it('names the figure a citation does not carry', () => {
		// Measured on a planning code: the anchor fell, the sentence was about the
		// right road, and it said ten metres beside a value displaying thirty-five.
		const sentence =
			'En bordure de la RN 117, en respectant un recul minimum de 10 metres ' +
			"par rapport aux limites d'emprise";
		expect(missingFigures(sentence, "35 m de l'axe")).toEqual(['35']);
	});

	it('has nothing to miss when the value announces no figure', () => {
		expect(missingFigures('implantation libre', "A l'alignement")).toEqual([]);
	});

	it('refuses a rounded figure, on the mark the document writes', () => {
		expect(missingFigures('2 415 065,40 EUR au total', '2 415 065', { decimal: ',' })).toEqual([
			'2 415 065'
		]);
		expect(missingFigures('2 415 065,40 EUR au total', '2 415 065,40', { decimal: ',' })).toEqual(
			[]
		);
	});

	it('reads a small number written out, in either direction', () => {
		const options = { spelled: SPELLED };
		expect(missingFigures('il est exige 1 place par logement', 'une place', options)).toEqual([]);
		expect(missingFigures('il est exige une place par logement', '1 place', options)).toEqual([]);
	});

	it('does not find a spelled number inside a longer word', () => {
		expect(missingFigures('chacune des faces', 'une place', { spelled: SPELLED })).toEqual(['1']);
	});

	it('proves a repeated figure once', () => {
		expect(missingFigures('recul de 5 metres', 'de 5 m a 5 m')).toEqual([]);
	});
});

describe('proofSpan', () => {
	it('points at the figure, from its first reading', () => {
		const source = '9 metres, puis 9 metres';
		expect(proofSpan(source, '9 m')).toEqual({ start: 0, end: 1 });
	});

	it('encloses every announced figure, worst one deciding', () => {
		// A citation showing the 1 of "1 place per 40 m2" without its 40 proves
		// half of what it displays.
		const source = 'il est exige 1 place pour 40 logements';
		expect(proofSpan(source, '1 place pour 40 logements')).toEqual({
			start: source.indexOf('1 place'),
			end: source.indexOf('40') + 2
		});
	});

	it('counts a spelled number where it is written', () => {
		const source = 'il est exige une place par logement';
		expect(proofSpan(source, 'une place', { spelled: SPELLED })).toEqual({
			start: source.indexOf('une'),
			end: source.indexOf('une') + 3
		});
	});

	it('points at nothing when a figure is missing, and when there is none', () => {
		// Two different absences, and `missingFigures` is what tells them apart:
		// reporting either as a distance of zero would call a proof on screen
		// exactly where there is no proof at all.
		expect(proofSpan('un recul de 10 metres', '35 m')).toBeNull();
		expect(missingFigures('un recul de 10 metres', '35 m')).toEqual(['35']);
		expect(proofSpan('implantation libre', "A l'alignement")).toBeNull();
		expect(missingFigures('implantation libre', "A l'alignement")).toEqual([]);
	});

	it('indexes the string it was given, so a length-preserving mask stays true', () => {
		// A planning code writes "50 m2", which announces fifty and not two. The
		// masking is the caller's; keeping its length is what makes the span it
		// gets back an index into the text it displays.
		const shown = 'emprise limitee a 50 m2 de plancher';
		const masked = shown.replace('m2', 'm ');
		expect(proofSpan(masked, '50 m2'.replace('m2', 'm '))).toEqual({
			start: shown.indexOf('50'),
			end: shown.indexOf('50') + 2
		});
	});
});
