/**
 * Christian art and architecture, for the church events that have no picture of their own.
 *
 * A gudsteneste in Bremnes kyrkje arrives from a parish calendar with a title, a time and nothing
 * else — so `/hendingar` filled with identical generated tiles wherever the kyrkja importers
 * reached. This gives each of those rows an image instead: a painting, a manuscript, an icon, a
 * sculpture, a stave church, a cathedral. It is not decoration: it is named, dated where we know,
 * and links to its Wikipedia article, so a tile that used to say nothing now says "this is
 * Rembrandt's Return of the Prodigal Son, and here is where to read about it".
 *
 * ## It is not a claim about the event
 *
 * The image has nothing to do with the particular service, and the page says so under it in as
 * many words. The caption names the work, never the event: a piece of art beside a church notice,
 * chosen by nothing more than the event's id.
 *
 * ## Where the data came from
 *
 * Each entry was resolved once through the Wikipedia and Commons APIs: the article's lead image,
 * its licence, and a rendition 1280 pixels wide (`sourceUrl`, with that file's own `width` and
 * `height`). Every image was looked at on a contact sheet before it went in.
 *
 * Two kinds of licence are accepted, and the caption differs between them:
 *
 * - **Public domain and CC0** — the paintings and manuscripts, and some photographs. No `licence`
 *   on the row; the caption says "fellesarv".
 * - **Attribution licences** — CC BY, CC BY-SA, the Free Art Licence, and Commons' plain
 *   "Attribution". Nearly every photograph of a building is one of these. The row carries
 *   `licence`, and every place the image is shown credits the photographer and links the licence
 *   and the file page: title, author, source, licence, which is what the licences ask.
 *   Non-commercial and no-derivatives licences are not accepted: we resize.
 *
 * The maker, the year and the photographer's credit are written by hand. Commons metadata
 * credits whoever photographed a painting as often as the painter, and a photographer's author
 * field is as often "User:X (please credit as Y)" as it is a name.
 *
 * `artworkFor` is pure and keyed on the event id, so a service keeps its painting forever, and
 * the server and the browser render the same one.
 *
 * ## Fetched from Wikimedia once, then served by us
 *
 * The first version hotlinked `upload.wikimedia.org`, and on phones the paintings showed as broken
 * images: Wikimedia rate-limits per client (20 requests at once came back 74 of 80 `429`), a
 * listing is a burst, and a phone on a carrier network shares its address with many others.
 *
 * So the browser never asks Wikimedia. It asks `/church-art/v1/<file>-<width>`, and the first such
 * request fetches `sourceUrl` once, encodes every width below as AVIF and as WebP, and keeps them
 * in blob storage (`server/church-art-cache.ts`). Each browser gets the smaller AVIF if its
 * `Accept` says it can show it, and WebP otherwise. No image file is in the repository.
 *
 * The widths are computed from the source's dimensions rather than stored, so the `srcset`
 * descriptors and the files the cache writes cannot disagree: 320 and 640 for the tiles, and one
 * bounded by 1280×1600 for the event page, which caps the image height anyway. A tall portrait
 * at 1280 wide would be 2500 pixels nobody sees.
 *
 * `v1` is in the path because the responses are cached as immutable. Changing the encoder or the
 * widths means a new version, so no browser keeps an old file under a name that now means another.
 */

export const CHURCH_ART_VERSION = 'v1';

/** One row of the table: what it is, where it came from. */
export type ChurchImage = {
	/** The work, as its article names it. English: it is a title, not prose. */
	work: string;
	/** Who made the work — painter, sculptor, architect. Null for a building nobody is named for. */
	artist: string | null;
	/** A single year, or a range where the work took several. Null where none is known. */
	year: string | null;
	/** Where to read about it. The whole point of showing it. */
	articleUrl: string;
	/** The Commons rendition the cache encodes from. Fetched once, by the server, never by a browser. */
	sourceUrl: string;
	/** The stem of the served files: `<file>-<width>`. */
	file: string;
	/** The dimensions of the file at `sourceUrl`. */
	width: number;
	height: number;
	/** Absent for public domain and CC0. Present, it must be shown wherever the image is. */
	licence?: Licence;
};

/** What an attribution licence asks to be shown beside the image. */
export type Licence = {
	/** As Commons names it: `CC BY-SA 4.0`, `FAL`, `Attribution`. */
	name: string;
	/** The licence text. For Commons' plain "Attribution", the file page, which is where its terms are. */
	url: string;
	/** The photographer, as they asked to be credited. */
	author: string;
	/** The file's page on Commons: the source. */
	page: string;
};

/** An image, resolved to the addresses an `<img>` needs. */
export type Artwork = Pick<ChurchImage, 'work' | 'artist' | 'year' | 'articleUrl' | 'licence'> & {
	src: string;
	srcset: string;
};

const ARTWORKS: readonly ChurchImage[] = [
	{
		work: 'Adoration of the Magi',
		artist: 'Sandro Botticelli',
		year: '1474–1476',
		articleUrl: 'https://en.wikipedia.org/wiki/Adoration_of_the_Magi_%28Botticelli%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9d/Botticelli_-_Adoration_of_the_Magi_%28Zanobi_Altar%29_-_Uffizi.jpg/1280px-Botticelli_-_Adoration_of_the_Magi_%28Zanobi_Altar%29_-_Uffizi.jpg',
		file: 'adoration-of-the-magi-botticelli',
		width: 1280,
		height: 1043
	},
	{
		work: 'Adoration of the Shepherds',
		artist: 'El Greco',
		year: '1612–1614',
		articleUrl: 'https://en.wikipedia.org/wiki/Adoration_of_the_Shepherds_%28El_Greco%2C_Madrid%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/6/63/The_Adoration_of_the_Shepherds%2C_El_Greco.jpg/1280px-The_Adoration_of_the_Shepherds%2C_El_Greco.jpg',
		file: 'adoration-of-the-shepherds-el-greco-madrid',
		width: 1280,
		height: 2282
	},
	{
		work: 'Agony in the Garden',
		artist: 'Andrea Mantegna',
		year: '1455–1456',
		articleUrl: 'https://en.wikipedia.org/wiki/Agony_in_the_Garden_%28Mantegna%2C_London%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a3/Mantegna%2C_Andrea_-_Agony_in_the_Garden_-_National_Gallery%2C_London.jpg/1280px-Mantegna%2C_Andrea_-_Agony_in_the_Garden_-_National_Gallery%2C_London.jpg',
		file: 'agony-in-the-garden-mantegna-london',
		width: 1280,
		height: 991
	},
	{
		work: 'Annunciation',
		artist: 'Jan van Eyck',
		year: '1433–1435',
		articleUrl: 'https://en.wikipedia.org/wiki/Annunciation_%28van_Eyck%2C_Madrid%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/3/34/Jan_van_Eyck%2C_Around_1390-1441_-_The_Annuciation_Diptych_-_Google_Art_Project.jpg/1280px-Jan_van_Eyck%2C_Around_1390-1441_-_The_Annuciation_Diptych_-_Google_Art_Project.jpg',
		file: 'annunciation-van-eyck-madrid',
		width: 1280,
		height: 1040
	},
	{
		work: 'Christ Carrying the Cross',
		artist: 'El Greco',
		year: '1580',
		articleUrl:
			'https://en.wikipedia.org/wiki/Christ_Carrying_the_Cross_%28El_Greco%2C_New_York%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/b/bb/Cristo_abrazado_a_la_cruz_El_Greco.jpg',
		file: 'christ-carrying-the-cross-el-greco-new-york',
		width: 900,
		height: 1252
	},
	{
		work: 'Christ Pantocrator',
		artist: 'Unknown icon painter',
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Christ_Pantocrator_%28Sinai%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4a/Spas_vsederzhitel_sinay.jpg/1280px-Spas_vsederzhitel_sinay.jpg',
		file: 'christ-pantocrator-sinai',
		width: 1280,
		height: 2388
	},
	{
		work: 'Ghent Altarpiece',
		artist: 'Hubert and Jan van Eyck',
		year: '1432',
		articleUrl: 'https://en.wikipedia.org/wiki/Ghent_Altarpiece',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/5/50/Ghent_Altarpiece_Google_Art_Project.jpg/1280px-Ghent_Altarpiece_Google_Art_Project.jpg',
		file: 'ghent-altarpiece',
		width: 1280,
		height: 944
	},
	{
		work: 'Isenheim Altarpiece',
		artist: 'Matthias Grünewald / Nikolaus Hagenauer',
		year: '1512–1516',
		articleUrl: 'https://en.wikipedia.org/wiki/Isenheim_Altarpiece',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e2/Isenheim_Altarpiece_-_In_situ_%28cropped%29.jpg/1280px-Isenheim_Altarpiece_-_In_situ_%28cropped%29.jpg',
		file: 'isenheim-altarpiece',
		width: 1280,
		height: 1002
	},
	{
		work: 'Jacob wrestling with the angel',
		artist: 'Gustave Doré',
		year: '1855',
		articleUrl: 'https://en.wikipedia.org/wiki/Jacob_wrestling_with_the_angel',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/4/45/Jacob_Wrestling_with_the_Angel.jpg',
		file: 'jacob-wrestling-with-the-angel',
		width: 795,
		height: 1000
	},
	{
		work: 'Lamentation of Christ',
		artist: 'Andrea Mantegna',
		year: '1470–1474',
		articleUrl: 'https://en.wikipedia.org/wiki/Lamentation_of_Christ_%28Mantegna%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f4/The_dead_Christ_and_three_mourners%2C_by_Andrea_Mantegna.jpg/1280px-The_dead_Christ_and_three_mourners%2C_by_Andrea_Mantegna.jpg',
		file: 'lamentation-of-christ-mantegna',
		width: 1280,
		height: 1063
	},
	{
		work: 'Madonna and Child',
		artist: 'Duccio di Buoninsegna',
		year: '1300',
		articleUrl: 'https://en.wikipedia.org/wiki/Madonna_and_Child_%28Duccio%2C_Metropolitan%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/6/65/Duccio_Di_Buoninsegna_-_Madonna_col_Bambino.jpg/1280px-Duccio_Di_Buoninsegna_-_Madonna_col_Bambino.jpg',
		file: 'madonna-and-child-duccio-metropolitan',
		width: 1280,
		height: 1697
	},
	{
		work: 'Madonna del Prato',
		artist: 'Raphael',
		year: '1505–1506',
		articleUrl: 'https://en.wikipedia.org/wiki/Madonna_del_Prato_%28Raphael%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Raphael_-_Madonna_in_the_Meadow_-_Google_Art_Project.jpg/1280px-Raphael_-_Madonna_in_the_Meadow_-_Google_Art_Project.jpg',
		file: 'madonna-del-prato-raphael',
		width: 1280,
		height: 1639
	},
	{
		work: 'Madonna of the Rosary',
		artist: 'Caravaggio',
		year: '1605–1607',
		articleUrl: 'https://en.wikipedia.org/wiki/Madonna_of_the_Rosary_%28Caravaggio%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1f/Michelangelo_Merisi%2C_called_Caravaggio_-_Madonna_of_the_Rosary_-_Google_Art_Project.jpg/1280px-Michelangelo_Merisi%2C_called_Caravaggio_-_Madonna_of_the_Rosary_-_Google_Art_Project.jpg',
		file: 'madonna-of-the-rosary-caravaggio',
		width: 1280,
		height: 1860
	},
	{
		work: 'Mond Crucifixion',
		artist: 'Raphael',
		year: '1502–1503',
		articleUrl: 'https://en.wikipedia.org/wiki/Mond_Crucifixion',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/1/18/CrocefissioneRaffaello.jpg/1280px-CrocefissioneRaffaello.jpg',
		file: 'mond-crucifixion',
		width: 1280,
		height: 2138
	},
	{
		work: 'Noli me tangere',
		artist: 'Titian',
		year: '1514',
		articleUrl: 'https://en.wikipedia.org/wiki/Noli_me_tangere_%28Titian%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/9/93/Noli-me-tangere-titien.jpg/1280px-Noli-me-tangere-titien.jpg',
		file: 'noli-me-tangere-titian',
		width: 1280,
		height: 1536
	},
	{
		work: 'Opening of the Fifth Seal',
		artist: 'El Greco',
		year: '1609–1614',
		articleUrl: 'https://en.wikipedia.org/wiki/Opening_of_the_Fifth_Seal',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b4/The_Vision_of_Saint_John_MET_DT1052.jpg/1280px-The_Vision_of_Saint_John_MET_DT1052.jpg',
		file: 'opening-of-the-fifth-seal',
		width: 1280,
		height: 1452
	},
	{
		work: 'Rest on the Flight into Egypt',
		artist: 'Caravaggio',
		year: '1597',
		articleUrl: 'https://en.wikipedia.org/wiki/Rest_on_the_Flight_into_Egypt_%28Caravaggio%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/7/73/Rest_on_the_Flight_into_Egypt-Caravaggio_%28c.1597%29.jpg/1280px-Rest_on_the_Flight_into_Egypt-Caravaggio_%28c.1597%29.jpg',
		file: 'rest-on-the-flight-into-egypt-caravaggio',
		width: 1280,
		height: 1033
	},
	{
		work: 'Saint Francis in Ecstasy',
		artist: 'Giovanni Bellini',
		year: '1480',
		articleUrl: 'https://en.wikipedia.org/wiki/Saint_Francis_in_Ecstasy_%28Bellini%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d7/Giovanni_Bellini_-_Saint_Francis_in_the_Desert_-_Google_Art_Project.jpg/1280px-Giovanni_Bellini_-_Saint_Francis_in_the_Desert_-_Google_Art_Project.jpg',
		file: 'saint-francis-in-ecstasy-bellini',
		width: 1280,
		height: 1123
	},
	{
		work: 'Saint Jerome Writing',
		artist: 'Caravaggio',
		year: '1605–1606',
		articleUrl: 'https://en.wikipedia.org/wiki/Saint_Jerome_Writing',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4d/Saint_Jerome_Writing-Caravaggio_%281605-6%29.jpg/1280px-Saint_Jerome_Writing-Caravaggio_%281605-6%29.jpg',
		file: 'saint-jerome-writing',
		width: 1280,
		height: 913
	},
	{
		work: 'Sistine Madonna',
		artist: 'Raphael',
		year: '1512–1527',
		articleUrl: 'https://en.wikipedia.org/wiki/Sistine_Madonna',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7a/RAFAEL_-_Madonna_Sixtina_%28Gem%C3%A4ldegalerie_Alter_Meister%2C_Dresden%2C_1513-14._%C3%93leo_sobre_lienzo%2C_265_x_196_cm%29.jpg/1280px-RAFAEL_-_Madonna_Sixtina_%28Gem%C3%A4ldegalerie_Alter_Meister%2C_Dresden%2C_1513-14._%C3%93leo_sobre_lienzo%2C_265_x_196_cm%29.jpg',
		file: 'sistine-madonna',
		width: 1280,
		height: 1755
	},
	{
		work: 'Supper at Emmaus',
		artist: 'Caravaggio',
		year: '1601',
		articleUrl: 'https://en.wikipedia.org/wiki/Supper_at_Emmaus_%28Caravaggio%2C_London%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4d/1602-3_Caravaggio%2CSupper_at_Emmaus_National_Gallery%2C_London.jpg/1280px-1602-3_Caravaggio%2CSupper_at_Emmaus_National_Gallery%2C_London.jpg',
		file: 'supper-at-emmaus-caravaggio-london',
		width: 1280,
		height: 910
	},
	{
		work: 'The Angelus',
		artist: 'Jean-François Millet',
		year: '1857–1859',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Angelus_%28painting%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/1/17/JEAN-FRAN%C3%87OIS_MILLET_-_El_%C3%81ngelus_%28Museo_de_Orsay%2C_1857-1859._%C3%93leo_sobre_lienzo%2C_55.5_x_66_cm%29.jpg/1280px-JEAN-FRAN%C3%87OIS_MILLET_-_El_%C3%81ngelus_%28Museo_de_Orsay%2C_1857-1859._%C3%93leo_sobre_lienzo%2C_55.5_x_66_cm%29.jpg',
		file: 'the-angelus-painting',
		width: 1280,
		height: 1064
	},
	{
		work: 'The Baptism of Christ',
		artist: 'Piero della Francesca',
		year: '1448–1450',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Baptism_of_Christ_%28Piero_della_Francesca%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Piero_della_Francesca_-_Baptism_of_Christ_-_WGA17595.jpg/1280px-Piero_della_Francesca_-_Baptism_of_Christ_-_WGA17595.jpg',
		file: 'the-baptism-of-christ-piero-della-francesca',
		width: 1280,
		height: 1870
	},
	{
		work: 'The Calling of Saint Matthew',
		artist: 'Caravaggio',
		year: '1599–1600',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Calling_of_Saint_Matthew',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/5/59/Caravaggio_%E2%80%94_The_Calling_of_Saint_Matthew.jpg/1280px-Caravaggio_%E2%80%94_The_Calling_of_Saint_Matthew.jpg',
		file: 'the-calling-of-saint-matthew',
		width: 1280,
		height: 1209
	},
	{
		work: 'The Conversion of Saint Paul',
		artist: 'Caravaggio',
		year: '1600',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Conversion_of_Saint_Paul_%28Caravaggio%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bb/The_Conversion_of_Saint_Paul-Caravaggio_%28c._1600-1%29.jpg/1280px-The_Conversion_of_Saint_Paul-Caravaggio_%28c._1600-1%29.jpg',
		file: 'the-conversion-of-saint-paul-caravaggio',
		width: 1280,
		height: 1598
	},
	{
		work: 'The Creation of Adam',
		artist: 'Michelangelo',
		year: '1511',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Creation_of_Adam',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5b/Michelangelo_-_Creation_of_Adam_%28cropped%29.jpg/1280px-Michelangelo_-_Creation_of_Adam_%28cropped%29.jpg',
		file: 'the-creation-of-adam',
		width: 1280,
		height: 581
	},
	{
		work: 'The Deposition from the Cross',
		artist: 'Pontormo',
		year: '1525–1528',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Deposition_from_the_Cross_%28Pontormo%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/5/58/Jacopo_Pontormo_-_Kreuzabnahme_Christi.jpg/1280px-Jacopo_Pontormo_-_Kreuzabnahme_Christi.jpg',
		file: 'the-deposition-from-the-cross-pontormo',
		width: 1280,
		height: 2053
	},
	{
		work: 'The Descent from the Cross',
		artist: 'Peter Paul Rubens',
		year: '1612–1614',
		articleUrl:
			'https://en.wikipedia.org/wiki/The_Descent_from_the_Cross_%28Rubens%2C_1612%E2%80%931614%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/3/30/Peter_Paul_Rubens_-_The_Descent_from_the_Cross_%28Antwerp_Cathedral%29.%2C_c._1613.jpg/1280px-Peter_Paul_Rubens_-_The_Descent_from_the_Cross_%28Antwerp_Cathedral%29.%2C_c._1613.jpg',
		file: 'the-descent-from-the-cross-rubens-1612-1614',
		width: 1280,
		height: 1741
	},
	{
		work: 'The Elevation of the Cross',
		artist: 'Peter Paul Rubens',
		year: '1610–1611',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Elevation_of_the_Cross_%28Rubens%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/c/ca/Peter_Paul_Rubens_-_Raising_of_the_Cross_%28Antwerp_Cathedral%29.JPG/1280px-Peter_Paul_Rubens_-_Raising_of_the_Cross_%28Antwerp_Cathedral%29.JPG',
		file: 'the-elevation-of-the-cross-rubens',
		width: 1280,
		height: 920
	},
	{
		work: 'The Entombment of Christ',
		artist: 'Caravaggio',
		year: '1603–1604',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Entombment_of_Christ_%28Caravaggio%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/3/34/The_Entombment_of_Christ-Caravaggio_%28c.1602-3%29.jpg/1280px-The_Entombment_of_Christ-Caravaggio_%28c.1602-3%29.jpg',
		file: 'the-entombment-of-christ-caravaggio',
		width: 1280,
		height: 1901
	},
	{
		work: 'The Garden of Earthly Delights',
		artist: 'Hieronymus Bosch',
		year: '1480–1505',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Garden_of_Earthly_Delights',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/9/96/The_Garden_of_earthly_delights.jpg/1280px-The_Garden_of_earthly_delights.jpg',
		file: 'the-garden-of-earthly-delights',
		width: 1280,
		height: 729
	},
	{
		work: 'The Incredulity of Saint Thomas',
		artist: 'Caravaggio',
		year: '1601–1602',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Incredulity_of_Saint_Thomas_%28Caravaggio%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6c/Der_ungl%C3%A4ubige_Thomas_-_Michelangelo_Merisi%2C_named_Caravaggio.jpg/1280px-Der_ungl%C3%A4ubige_Thomas_-_Michelangelo_Merisi%2C_named_Caravaggio.jpg',
		file: 'the-incredulity-of-saint-thomas-caravaggio',
		width: 1280,
		height: 950
	},
	{
		work: 'The Last Supper',
		artist: 'Leonardo da Vinci',
		year: '1495–1498',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Last_Supper_%28Leonardo%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/4/48/The_Last_Supper_-_Leonardo_Da_Vinci_-_High_Resolution_32x16.jpg/1280px-The_Last_Supper_-_Leonardo_Da_Vinci_-_High_Resolution_32x16.jpg',
		file: 'the-last-supper-leonardo',
		width: 1280,
		height: 640
	},
	{
		work: 'The Light of the World',
		artist: 'William Holman Hunt',
		year: '1851–1852',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Light_of_the_World_%28Hunt%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bc/Hunt-light-of-the-world.jpeg/1280px-Hunt-light-of-the-world.jpeg',
		file: 'the-light-of-the-world-hunt',
		width: 1280,
		height: 2540
	},
	{
		work: 'The Parable of the Blind',
		artist: 'Pieter Brueghel the Elder',
		year: '1568',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Parable_of_the_Blind',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c1/%D0%9F%D1%80%D0%B8%D1%82%D1%87%D0%B0_%D0%BE_%D1%81%D0%BB%D0%B5%D0%BF%D1%8B%D1%85.jpeg/1280px-%D0%9F%D1%80%D0%B8%D1%82%D1%87%D0%B0_%D0%BE_%D1%81%D0%BB%D0%B5%D0%BF%D1%8B%D1%85.jpeg',
		file: 'the-parable-of-the-blind',
		width: 1280,
		height: 721
	},
	{
		work: 'The Return of the Prodigal Son',
		artist: 'Rembrandt',
		year: '1668',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Return_of_the_Prodigal_Son_%28Rembrandt%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/9/93/Rembrandt_Harmensz_van_Rijn_-_Return_of_the_Prodigal_Son_-_Google_Art_Project.jpg/1280px-Rembrandt_Harmensz_van_Rijn_-_Return_of_the_Prodigal_Son_-_Google_Art_Project.jpg',
		file: 'the-return-of-the-prodigal-son-rembrandt',
		width: 1280,
		height: 1670
	},
	{
		work: 'The Storm on the Sea of Galilee',
		artist: 'Rembrandt',
		year: '1633',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Storm_on_the_Sea_of_Galilee',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f3/Rembrandt_Christ_in_the_Storm_on_the_Lake_of_Galilee.jpg/1280px-Rembrandt_Christ_in_the_Storm_on_the_Lake_of_Galilee.jpg',
		file: 'the-storm-on-the-sea-of-galilee',
		width: 1280,
		height: 1591
	},
	{
		work: 'The Tribute Money',
		artist: 'Masaccio',
		year: '1424–1428',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Tribute_Money_%28Masaccio%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b3/The_Tribute_Money_by_Masaccio.jpg/1280px-The_Tribute_Money_by_Masaccio.jpg',
		file: 'the-tribute-money-masaccio',
		width: 1280,
		height: 591
	},
	{
		work: 'The Wedding at Cana',
		artist: 'Paolo Veronese',
		year: '1563',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Wedding_at_Cana_%28Veronese%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/Paolo_Veronese_008.jpg/1280px-Paolo_Veronese_008.jpg',
		file: 'the-wedding-at-cana-veronese',
		width: 1280,
		height: 870
	},
	{
		work: 'Transfiguration',
		artist: 'Raphael',
		year: '1516–1520',
		articleUrl: 'https://en.wikipedia.org/wiki/Transfiguration_%28Raphael%29',
		sourceUrl: 'https://upload.wikimedia.org/wikipedia/commons/5/51/Transfiguration_Raphael.jpg',
		file: 'transfiguration-raphael',
		width: 1067,
		height: 1608
	},
	{
		work: 'Virgin of the Rocks',
		artist: 'Leonardo da Vinci',
		year: '1483–1486',
		articleUrl: 'https://en.wikipedia.org/wiki/Virgin_of_the_Rocks',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e4/Leonardo_Da_Vinci_-_Vergine_delle_Rocce_%28Louvre%29.jpg/1280px-Leonardo_Da_Vinci_-_Vergine_delle_Rocce_%28Louvre%29.jpg',
		file: 'virgin-of-the-rocks',
		width: 1280,
		height: 2030
	},
	{
		work: 'The Virgin and Child with Saint Anne',
		artist: 'Leonardo da Vinci',
		year: '1503–1519',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Virgin_and_Child_with_Saint_Anne_%28Leonardo%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f8/Sainte_Anne_Leonard.jpg/1280px-Sainte_Anne_Leonard.jpg',
		file: 'the-virgin-and-child-with-saint-anne-leonardo',
		width: 1280,
		height: 1693
	},
	{
		work: 'Annunciation',
		artist: 'Leonardo da Vinci',
		year: '1472–1476',
		articleUrl: 'https://en.wikipedia.org/wiki/Annunciation_%28Leonardo%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9f/Annunciation_%28Leonardo_c._1472%E2%80%931476%29.jpg/1280px-Annunciation_%28Leonardo_c._1472%E2%80%931476%29.jpg',
		file: 'annunciation-leonardo',
		width: 1280,
		height: 587
	},
	{
		work: 'Mérode Altarpiece',
		artist: 'Robert Campin',
		year: '1425–1428',
		articleUrl: 'https://en.wikipedia.org/wiki/M%C3%A9rode_Altarpiece',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/2/24/Robert_Campin_006.jpg/1280px-Robert_Campin_006.jpg',
		file: 'merode-altarpiece',
		width: 1280,
		height: 1235
	},
	{
		work: 'Portinari Altarpiece',
		artist: 'Hugo van der Goes',
		year: '1475–1476',
		articleUrl: 'https://en.wikipedia.org/wiki/Portinari_Altarpiece',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1c/Hugo_van_der_Goes_-_Portinari_Triptych_%28c._1477%29.jpg/1280px-Hugo_van_der_Goes_-_Portinari_Triptych_%28c._1477%29.jpg',
		file: 'portinari-altarpiece',
		width: 1280,
		height: 531
	},
	{
		work: 'Holy Trinity',
		artist: 'Masaccio',
		year: '1425–1427',
		articleUrl: 'https://en.wikipedia.org/wiki/Holy_Trinity_%28Masaccio%29',
		sourceUrl: 'https://upload.wikimedia.org/wikipedia/commons/d/d2/Masaccio%2C_trinit%C3%A0.jpg',
		file: 'holy-trinity-masaccio',
		width: 1028,
		height: 2073
	},
	{
		work: 'The Raising of Lazarus',
		artist: 'Sebastiano del Piombo',
		year: '1517–1519',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Raising_of_Lazarus_%28Sebastiano_del_Piombo%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f4/Sebastiano_del_Piombo%2C_The_Raising_of_Lazarus.jpg/1280px-Sebastiano_del_Piombo%2C_The_Raising_of_Lazarus.jpg',
		file: 'the-raising-of-lazarus-sebastiano-del-piombo',
		width: 1280,
		height: 1699
	},
	{
		work: 'Doni Tondo',
		artist: 'Michelangelo',
		year: '1506',
		articleUrl: 'https://en.wikipedia.org/wiki/Doni_Tondo',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/4/44/Tondo_Doni_2015.png/1280px-Tondo_Doni_2015.png',
		file: 'doni-tondo',
		width: 1280,
		height: 1318
	},
	{
		work: 'The Last Judgment',
		artist: 'Michelangelo',
		year: '1536–1541',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Last_Judgment_%28Michelangelo%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/1/18/Last_Judgement_%28Michelangelo%29.jpg/1280px-Last_Judgement_%28Michelangelo%29.jpg',
		file: 'the-last-judgment-michelangelo',
		width: 1280,
		height: 1410
	},
	{
		work: 'Christ in the House of His Parents',
		artist: 'John Everett Millais',
		year: '1849–1850',
		articleUrl: 'https://en.wikipedia.org/wiki/Christ_in_the_House_of_His_Parents',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/John_Everett_Millais_-_Christ_in_the_House_of_His_Parents_%28%60The_Carpenter%27s_Shop%27%29_-_Google_Art_Project.jpg/1280px-John_Everett_Millais_-_Christ_in_the_House_of_His_Parents_%28%60The_Carpenter%27s_Shop%27%29_-_Google_Art_Project.jpg',
		file: 'christ-in-the-house-of-his-parents',
		width: 1280,
		height: 777
	},
	{
		work: 'The Scapegoat',
		artist: 'William Holman Hunt',
		year: '1854–1856',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Scapegoat_%28painting%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/9/97/William_Holman_Hunt_-_The_Scapegoat.jpg/1280px-William_Holman_Hunt_-_The_Scapegoat.jpg',
		file: 'the-scapegoat-painting',
		width: 1280,
		height: 785
	},
	{
		work: 'Maestà',
		artist: 'Duccio di Buoninsegna',
		year: '1308–1311',
		articleUrl: 'https://en.wikipedia.org/wiki/Maest%C3%A0_%28Duccio%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f0/Duccio_maesta1021.jpg/1280px-Duccio_maesta1021.jpg',
		file: 'maesta-duccio',
		width: 1280,
		height: 631
	},
	{
		work: 'The Resurrection',
		artist: 'Piero della Francesca',
		year: '1463–1465',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Resurrection_%28Piero_della_Francesca%29',
		sourceUrl: 'https://upload.wikimedia.org/wikipedia/commons/c/c2/Resurrection.JPG',
		file: 'the-resurrection-piero-della-francesca',
		width: 730,
		height: 826
	},
	{
		work: 'Lamentation (The Mourning of Christ)',
		artist: 'Giotto',
		year: '1305',
		articleUrl: 'https://en.wikipedia.org/wiki/Lamentation_%28The_Mourning_of_Christ%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/3/34/Compianto_sul_Cristo_morto.jpg/1280px-Compianto_sul_Cristo_morto.jpg',
		file: 'lamentation-the-mourning-of-christ',
		width: 1280,
		height: 1204
	},
	{
		work: 'Brera Madonna',
		artist: 'Piero della Francesca',
		year: '1472–1474',
		articleUrl: 'https://en.wikipedia.org/wiki/Brera_Madonna',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9e/Piero_della_Francesca_046.jpg/1280px-Piero_della_Francesca_046.jpg',
		file: 'brera-madonna',
		width: 1280,
		height: 1835
	},
	{
		work: 'Flagellation of Christ',
		artist: 'Piero della Francesca',
		year: '1468–1470',
		articleUrl: 'https://en.wikipedia.org/wiki/Flagellation_of_Christ_%28Piero_della_Francesca%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2b/Piero_della_Francesca_-_Flagelaci%C3%B3n_de_Cristo%2C_1468-1470_%28Galleria_Nazionale_delle_Marche%2C_Urbino%29.png/1280px-Piero_della_Francesca_-_Flagelaci%C3%B3n_de_Cristo%2C_1468-1470_%28Galleria_Nazionale_delle_Marche%2C_Urbino%29.png',
		file: 'flagellation-of-christ-piero-della-francesca',
		width: 1280,
		height: 915
	},
	{
		work: 'Ognissanti Madonna',
		artist: 'Giotto',
		year: '1306–1310',
		articleUrl: 'https://en.wikipedia.org/wiki/Ognissanti_Madonna',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/5/57/Giotto%2C_1267_Around-1337_-_Maest%C3%A0_-_Google_Art_Project.jpg/1280px-Giotto%2C_1267_Around-1337_-_Maest%C3%A0_-_Google_Art_Project.jpg',
		file: 'ognissanti-madonna',
		width: 1280,
		height: 2037
	},
	{
		work: 'Death of the Virgin',
		artist: 'Caravaggio',
		year: '1601–1606',
		articleUrl: 'https://en.wikipedia.org/wiki/Death_of_the_Virgin_%28Caravaggio%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/7/78/Death_of_the_Virgin-Caravaggio_%281606%29.jpg/1280px-Death_of_the_Virgin-Caravaggio_%281606%29.jpg',
		file: 'death-of-the-virgin-caravaggio',
		width: 1280,
		height: 1932
	},
	{
		work: 'David with the Head of Goliath',
		artist: 'Caravaggio',
		year: '1610',
		articleUrl:
			'https://en.wikipedia.org/wiki/David_with_the_Head_of_Goliath_%28Caravaggio%2C_Rome%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f6/David_with_the_Head_of_Goliath-Caravaggio_%281610%29.jpg/1280px-David_with_the_Head_of_Goliath-Caravaggio_%281610%29.jpg',
		file: 'david-with-the-head-of-goliath-caravaggio-rome',
		width: 1280,
		height: 1584
	},
	{
		work: "Belshazzar's Feast",
		artist: 'Rembrandt',
		year: '1635–1638',
		articleUrl: 'https://en.wikipedia.org/wiki/Belshazzar%27s_Feast_%28Rembrandt%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0e/Rembrandt-Belsazar.jpg/1280px-Rembrandt-Belsazar.jpg',
		file: 'belshazzar-s-feast-rembrandt',
		width: 1280,
		height: 1019
	},
	{
		work: 'The Tower of Babel',
		artist: 'Pieter Bruegel the Elder',
		year: '1563',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Tower_of_Babel_%28Bruegel%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/f/fc/Pieter_Bruegel_the_Elder_-_The_Tower_of_Babel_%28Vienna%29_-_Google_Art_Project_-_edited.jpg/1280px-Pieter_Bruegel_the_Elder_-_The_Tower_of_Babel_%28Vienna%29_-_Google_Art_Project_-_edited.jpg',
		file: 'the-tower-of-babel-bruegel',
		width: 1280,
		height: 937
	},
	{
		work: 'The Last Judgment',
		artist: 'Hans Memling',
		year: '1467–1471',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Last_Judgment_%28Memling%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c9/Das_J%C3%BCngste_Gericht_%28Memling%29.jpg/1280px-Das_J%C3%BCngste_Gericht_%28Memling%29.jpg',
		file: 'the-last-judgment-memling',
		width: 1280,
		height: 852
	},
	{
		work: 'The Burial of the Count of Orgaz',
		artist: 'El Greco',
		year: '1586–1588',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Burial_of_the_Count_of_Orgaz',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/f/ff/El_Greco_-_The_Burial_of_the_Count_of_Orgaz.JPG/1280px-El_Greco_-_The_Burial_of_the_Count_of_Orgaz.JPG',
		file: 'the-burial-of-the-count-of-orgaz',
		width: 1280,
		height: 1568
	},
	{
		work: 'Christ in the House of Martha and Mary',
		artist: 'Diego Velázquez',
		year: '1618',
		articleUrl:
			'https://en.wikipedia.org/wiki/Christ_in_the_House_of_Martha_and_Mary_%28Vel%C3%A1zquez%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e8/Cristo_en_casa_de_Marta_y_Mar%C3%ADa%2C_by_Diego_Vel%C3%A1zquez.jpg/1280px-Cristo_en_casa_de_Marta_y_Mar%C3%ADa%2C_by_Diego_Vel%C3%A1zquez.jpg',
		file: 'christ-in-the-house-of-martha-and-mary-velazquez',
		width: 1280,
		height: 742
	},
	{
		work: 'Assumption of the Virgin',
		artist: 'Titian',
		year: '1516–1518',
		articleUrl: 'https://en.wikipedia.org/wiki/Assumption_of_the_Virgin_%28Titian%29',
		sourceUrl: 'https://upload.wikimedia.org/wikipedia/commons/9/9e/Tizian_041.jpg',
		file: 'assumption-of-the-virgin-titian',
		width: 1050,
		height: 1932
	},
	{
		work: 'Madonna of Chancellor Rolin',
		artist: 'Jan van Eyck',
		year: '1435',
		articleUrl: 'https://en.wikipedia.org/wiki/Madonna_of_Chancellor_Rolin',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2c/The_Virgin_with_Chancellor_Rolin_by_Jan_van_Eyck_%28Louvre%29.webp/1280px-The_Virgin_with_Chancellor_Rolin_by_Jan_van_Eyck_%28Louvre%29.webp',
		file: 'madonna-of-chancellor-rolin',
		width: 1280,
		height: 1330
	},
	{
		work: 'The Feast in the House of Levi',
		artist: 'Paolo Veronese',
		year: '1573',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Feast_in_the_House_of_Levi',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/4/48/The_Feast_in_the_House_of_Levi_by_Paolo_Veronese_%28edited_2%29.jpg/1280px-The_Feast_in_the_House_of_Levi_by_Paolo_Veronese_%28edited_2%29.jpg',
		file: 'the-feast-in-the-house-of-levi',
		width: 1280,
		height: 537
	},
	{
		work: 'Christ Crucified',
		artist: 'Diego Velázquez',
		year: '1632',
		articleUrl: 'https://en.wikipedia.org/wiki/Christ_Crucified_%28Vel%C3%A1zquez%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d7/Cristo_crucificado.jpg/1280px-Cristo_crucificado.jpg',
		file: 'christ-crucified-velazquez',
		width: 1280,
		height: 1909
	},
	{
		work: 'Miracle of the Slave',
		artist: 'Tintoretto',
		year: '1548',
		articleUrl: 'https://en.wikipedia.org/wiki/Miracle_of_the_Slave_%28Tintoretto%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e9/Tintoretto_-_Miracle_of_the_Slave.jpg/1280px-Tintoretto_-_Miracle_of_the_Slave.jpg',
		file: 'miracle-of-the-slave-tintoretto',
		width: 1280,
		height: 998
	},
	{
		work: 'The Last Supper',
		artist: 'Tintoretto',
		year: '1592–1594',
		articleUrl: 'https://en.wikipedia.org/wiki/Last_Supper_%28Tintoretto%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/4/46/Jacopo_Tintoretto_-_The_Last_Supper_-_WGA22649.jpg/1280px-Jacopo_Tintoretto_-_The_Last_Supper_-_WGA22649.jpg',
		file: 'last-supper-tintoretto',
		width: 1280,
		height: 814
	},
	{
		work: 'The Descent from the Cross',
		artist: 'Rogier van der Weyden',
		year: '1435–1438',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Descent_from_the_Cross_%28van_der_Weyden%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/El_Descendimiento%2C_by_Rogier_van_der_Weyden%2C_from_Prado_in_Google_Earth.jpg/1280px-El_Descendimiento%2C_by_Rogier_van_der_Weyden%2C_from_Prado_in_Google_Earth.jpg',
		file: 'the-descent-from-the-cross-van-der-weyden',
		width: 1280,
		height: 993
	},
	{
		work: 'The Seven Works of Mercy',
		artist: 'Caravaggio',
		year: '1607',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Seven_Works_of_Mercy_%28Caravaggio%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d7/Caravaggio_-_Sette_opere_di_Misericordia.jpg/1280px-Caravaggio_-_Sette_opere_di_Misericordia.jpg',
		file: 'the-seven-works-of-mercy-caravaggio',
		width: 1280,
		height: 1889
	},
	{
		work: 'The Procession to Calvary',
		artist: 'Pieter Bruegel the Elder',
		year: '1564',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Procession_to_Calvary_%28Bruegel%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4e/Pieter_Bruegel_d._%C3%84._007.jpg/1280px-Pieter_Bruegel_d._%C3%84._007.jpg',
		file: 'the-procession-to-calvary-bruegel',
		width: 1280,
		height: 929
	},
	{
		work: 'The Census at Bethlehem',
		artist: 'Pieter Bruegel the Elder',
		year: '1566',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Census_at_Bethlehem',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/6/64/Pieter_Bruegel_der_%C3%84ltere_-_Volksz%C3%A4hlung_zu_Bethlehem.jpg/1280px-Pieter_Bruegel_der_%C3%84ltere_-_Volksz%C3%A4hlung_zu_Bethlehem.jpg',
		file: 'the-census-at-bethlehem',
		width: 1280,
		height: 887
	},
	{
		work: 'Virgin of Vladimir',
		artist: 'Unknown icon painter',
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Virgin_of_Vladimir',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/3/37/Virgin_of_Vladimir.jpg/1280px-Virgin_of_Vladimir.jpg',
		file: 'virgin-of-vladimir',
		width: 1280,
		height: 1864
	},
	{
		work: 'The Mystical Nativity',
		artist: 'Sandro Botticelli',
		year: '1500',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Mystical_Nativity',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f8/Mystic_Nativity%2C_Sandro_Botticelli.jpg/1280px-Mystic_Nativity%2C_Sandro_Botticelli.jpg',
		file: 'the-mystical-nativity',
		width: 1280,
		height: 1854
	},
	{
		work: 'Alba Madonna',
		artist: 'Raphael',
		year: '1510',
		articleUrl: 'https://en.wikipedia.org/wiki/Alba_Madonna',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/7/75/Raphael%2C_The_Alba_Madonna%2C_c._1510%2C_NGA_26.jpg/1280px-Raphael%2C_The_Alba_Madonna%2C_c._1510%2C_NGA_26.jpg',
		file: 'alba-madonna',
		width: 1280,
		height: 1280
	},
	{
		work: 'Madonna della Seggiola',
		artist: 'Raphael',
		year: '1513–1514',
		articleUrl: 'https://en.wikipedia.org/wiki/Madonna_della_Seggiola',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/0/09/Raphael_Madonna_della_seggiola.jpg/1280px-Raphael_Madonna_della_seggiola.jpg',
		file: 'madonna-della-seggiola',
		width: 1280,
		height: 1308
	},
	{
		work: 'Madonna of the Magnificat',
		artist: 'Sandro Botticelli',
		year: '1480–1481',
		articleUrl: 'https://en.wikipedia.org/wiki/Madonna_of_the_Magnificat',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/0/04/Magnificat_Madonna_-_Botticelli_%28uffici%29_b.jpg/1280px-Magnificat_Madonna_-_Botticelli_%28uffici%29_b.jpg',
		file: 'madonna-of-the-magnificat',
		width: 1280,
		height: 1272
	},
	{
		work: 'The Great Day of His Wrath',
		artist: 'John Martin',
		year: '1851–1853',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Great_Day_of_His_Wrath',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/5/50/John_Martin_-_The_Great_Day_of_His_Wrath_-_Google_Art_Project.jpg/1280px-John_Martin_-_The_Great_Day_of_His_Wrath_-_Google_Art_Project.jpg',
		file: 'the-great-day-of-his-wrath',
		width: 1280,
		height: 826
	},
	{
		work: 'The Ancient of Days',
		artist: 'William Blake',
		year: '1794',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Ancient_of_Days',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ac/Europe_a_Prophecy_copy_K_plate_01.jpg/1280px-Europe_a_Prophecy_copy_K_plate_01.jpg',
		file: 'the-ancient-of-days',
		width: 1280,
		height: 1734
	},
	{
		work: 'Trinity',
		artist: 'Andrei Rublev',
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Trinity_%28Andrei_Rublev%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0b/Angelsatmamre-trinity-rublev-1410.jpg/1280px-Angelsatmamre-trinity-rublev-1410.jpg',
		file: 'trinity-andrei-rublev',
		width: 1280,
		height: 1594
	},
	{
		work: 'Praying Hands',
		artist: 'Albrecht Dürer',
		year: '1508',
		articleUrl: 'https://en.wikipedia.org/wiki/Praying_Hands_%28D%C3%BCrer%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/6/63/Albrecht_D%C3%BCrer_-_Praying_Hands%2C_1508_-_Google_Art_Project.jpg/1280px-Albrecht_D%C3%BCrer_-_Praying_Hands%2C_1508_-_Google_Art_Project.jpg',
		file: 'praying-hands-durer',
		width: 1280,
		height: 1863
	},
	{
		work: 'Adoration of the Trinity',
		artist: 'Albrecht Dürer',
		year: '1511',
		articleUrl: 'https://en.wikipedia.org/wiki/Adoration_of_the_Trinity',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/6/61/Albrecht_D%C3%BCrer_-_Adoration_of_the_Trinity_%28Landauer_Altar%29_-_Google_Art_Project.jpg/1280px-Albrecht_D%C3%BCrer_-_Adoration_of_the_Trinity_%28Landauer_Altar%29_-_Google_Art_Project.jpg',
		file: 'adoration-of-the-trinity',
		width: 1280,
		height: 1400
	},
	{
		work: 'Madonna and Child with Two Angels',
		artist: 'Filippo Lippi',
		year: '1460–1465',
		articleUrl: 'https://en.wikipedia.org/wiki/Madonna_and_Child_%28Lippi%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/4/42/Madonna_and_Child_with_two_Angels_%28by_Filippo_Lippi%29_%E2%80%93_Galleria_degli_Uffizi%2C_Florence.jpg/1280px-Madonna_and_Child_with_two_Angels_%28by_Filippo_Lippi%29_%E2%80%93_Galleria_degli_Uffizi%2C_Florence.jpg',
		file: 'madonna-and-child-lippi',
		width: 1280,
		height: 1878
	},
	{
		work: 'Agnus Dei',
		artist: 'Francisco de Zurbarán',
		year: '1635–1640',
		articleUrl: 'https://en.wikipedia.org/wiki/Agnus_Dei_%28Zurbar%C3%A1n%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ef/Francisco_de_Zurbar%C3%A1n_006.jpg/1280px-Francisco_de_Zurbar%C3%A1n_006.jpg',
		file: 'agnus-dei-zurbaran',
		width: 1280,
		height: 759
	},
	{
		work: 'Cross in the Mountains',
		artist: 'Caspar David Friedrich',
		year: '1807–1808',
		articleUrl: 'https://en.wikipedia.org/wiki/Cross_in_the_Mountains',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/0/0a/Friedrich_Tetschener_Altar_1808.jpg',
		file: 'cross-in-the-mountains',
		width: 937,
		height: 1000
	},
	{
		work: 'The Annunciation',
		artist: 'Henry Ossawa Tanner',
		year: '1898',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Annunciation_%28Tanner%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ef/The_Annunciation%2C_Philadelphia_Museum_of_Art%2C_W1899-1-1-pma%2C_by_Henry_Ossawa_Tanner.jpg/1280px-The_Annunciation%2C_Philadelphia_Museum_of_Art%2C_W1899-1-1-pma%2C_by_Henry_Ossawa_Tanner.jpg',
		file: 'the-annunciation-tanner',
		width: 1280,
		height: 1027
	},
	{
		work: 'Wilton Diptych',
		artist: 'Unknown artist',
		year: '1395–1399',
		articleUrl: 'https://en.wikipedia.org/wiki/Wilton_Diptych',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/1/15/Wilton_Diptych.jpg/1280px-Wilton_Diptych.jpg',
		file: 'wilton-diptych',
		width: 1280,
		height: 993
	},
	{
		work: 'Benois Madonna',
		artist: 'Leonardo da Vinci',
		year: '1478–1480',
		articleUrl: 'https://en.wikipedia.org/wiki/Benois_Madonna',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/7/78/Leonardo%2C_Madonna_Benois.JPG/1280px-Leonardo%2C_Madonna_Benois.JPG',
		file: 'benois-madonna',
		width: 1280,
		height: 2051
	},
	{
		work: 'Madonna Litta',
		artist: 'Leonardo da Vinci',
		year: '1490–1491',
		articleUrl: 'https://en.wikipedia.org/wiki/Madonna_Litta',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6f/Leonardo_da_Vinci_attributed_-_Madonna_Litta.jpg/1280px-Leonardo_da_Vinci_attributed_-_Madonna_Litta.jpg',
		file: 'madonna-litta',
		width: 1280,
		height: 1633
	},
	{
		work: 'The Inspiration of Saint Matthew',
		artist: 'Caravaggio',
		year: '1602',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Inspiration_of_Saint_Matthew',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/5/58/Caravaggio_-_La_inspiraci%C3%B3n_de_San_Mateo_%28San_Luigi_dei_Francesi%2C_Roma%29.jpg/1280px-Caravaggio_-_La_inspiraci%C3%B3n_de_San_Mateo_%28San_Luigi_dei_Francesi%2C_Roma%29.jpg',
		file: 'the-inspiration-of-saint-matthew',
		width: 1280,
		height: 2003
	},
	{
		work: 'Madonna of the Carnation',
		artist: 'Leonardo da Vinci',
		year: '1478–1480',
		articleUrl: 'https://en.wikipedia.org/wiki/Madonna_of_the_Carnation',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f1/LEONARDO-DA-VINCI_-_MADONNA-MIT-DER-NELKE-7779_917154_BSTGS.jpg/1280px-LEONARDO-DA-VINCI_-_MADONNA-MIT-DER-NELKE-7779_917154_BSTGS.jpg',
		file: 'madonna-of-the-carnation',
		width: 1280,
		height: 1723
	},
	{
		work: 'Christ in the House of Martha and Mary',
		artist: 'Johannes Vermeer',
		year: '1654–1655',
		articleUrl:
			'https://en.wikipedia.org/wiki/Christ_in_the_House_of_Martha_and_Mary_%28Vermeer%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4f/Johannes_%28Jan%29_Vermeer_-_Christ_in_the_House_of_Martha_and_Mary_-_Google_Art_Project.jpg/1280px-Johannes_%28Jan%29_Vermeer_-_Christ_in_the_House_of_Martha_and_Mary_-_Google_Art_Project.jpg',
		file: 'christ-in-the-house-of-martha-and-mary-vermeer',
		width: 1280,
		height: 1481
	},
	{
		work: 'Coronation of the Virgin',
		artist: 'Fra Angelico',
		year: '1430–1432',
		articleUrl:
			'https://en.wikipedia.org/wiki/Coronation_of_the_Virgin_%28Fra_Angelico%2C_Louvre%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/2/21/Le_Couronnement_de_la_Vierge_-_Fra_Angelico_-_Mus%C3%A9e_du_Louvre_Peintures_INV_314_%3B_MR_220.jpg/1280px-Le_Couronnement_de_la_Vierge_-_Fra_Angelico_-_Mus%C3%A9e_du_Louvre_Peintures_INV_314_%3B_MR_220.jpg',
		file: 'coronation-of-the-virgin-fra-angelico-louvre',
		width: 1280,
		height: 1447
	},
	{
		work: 'Delivery of the Keys',
		artist: 'Pietro Perugino',
		year: '1481–1482',
		articleUrl: 'https://en.wikipedia.org/wiki/Delivery_of_the_Keys',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b4/Entrega_de_las_llaves_a_San_Pedro_%28Perugino%29.jpg/1280px-Entrega_de_las_llaves_a_San_Pedro_%28Perugino%29.jpg',
		file: 'delivery-of-the-keys',
		width: 1280,
		height: 772
	},
	{
		work: 'San Zaccaria Altarpiece',
		artist: 'Giovanni Bellini',
		year: '1505',
		articleUrl: 'https://en.wikipedia.org/wiki/San_Zaccaria_Altarpiece',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d7/Pala_di_San_Zaccaria_%28Venezia%29.jpg/1280px-Pala_di_San_Zaccaria_%28Venezia%29.jpg',
		file: 'san-zaccaria-altarpiece',
		width: 1280,
		height: 2291
	},
	{
		work: 'Annunciation',
		artist: 'Fra Angelico',
		year: '1440–1445',
		articleUrl: 'https://en.wikipedia.org/wiki/Annunciation_%28Fra_Angelico%2C_San_Marco%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bc/Fra_Angelico_-_Annunciation.jpg/1280px-Fra_Angelico_-_Annunciation.jpg',
		file: 'annunciation-fra-angelico-san-marco',
		width: 1280,
		height: 929
	},
	{
		work: 'Christ Blessing',
		artist: 'Giovanni Bellini',
		year: '1460',
		articleUrl: 'https://en.wikipedia.org/wiki/Christ_Blessing_%28Bellini%2C_1460%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/6/60/Giovanni_Bellini_Le_Christ_Benissant_1465_1470.jpg/1280px-Giovanni_Bellini_Le_Christ_Benissant_1465_1470.jpg',
		file: 'christ-blessing-bellini-1460',
		width: 1280,
		height: 1687
	},
	{
		work: 'Nidaros Cathedral',
		artist: null,
		year: '1070–1300',
		articleUrl: 'https://en.wikipedia.org/wiki/Nidaros_Cathedral',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/4/49/Nidaros_Cathedral%2C_Trondheim%2C_West_view_20150605_1.jpg/1280px-Nidaros_Cathedral%2C_Trondheim%2C_West_view_20150605_1.jpg',
		file: 'nidaros-cathedral',
		width: 1280,
		height: 1288,
		licence: {
			name: 'CC BY-SA 4.0',
			url: 'https://creativecommons.org/licenses/by-sa/4.0',
			author: 'DXR',
			page: 'https://commons.wikimedia.org/wiki/File:Nidaros_Cathedral,_Trondheim,_West_view_20150605_1.jpg'
		}
	},
	{
		work: 'Stavanger Cathedral',
		artist: null,
		year: 'c. 1125',
		articleUrl: 'https://en.wikipedia.org/wiki/Stavanger_Cathedral',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1e/Stavanger_Cathedral_2025.jpg/1280px-Stavanger_Cathedral_2025.jpg',
		file: 'stavanger-cathedral',
		width: 1280,
		height: 1707,
		licence: {
			name: 'CC BY 4.0',
			url: 'https://creativecommons.org/licenses/by/4.0',
			author: 'Cbusram',
			page: 'https://commons.wikimedia.org/wiki/File:Stavanger_Cathedral_2025.jpg'
		}
	},
	{
		work: 'Heddal Stave Church',
		artist: null,
		year: 'c. 1250',
		articleUrl: 'https://en.wikipedia.org/wiki/Heddal_Stave_Church',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d5/Stavechurch-heddal.jpg/1280px-Stavechurch-heddal.jpg',
		file: 'heddal-stave-church',
		width: 1280,
		height: 1130,
		licence: {
			name: 'Attribution',
			url: 'https://commons.wikimedia.org/wiki/File:Stavechurch-heddal.jpg',
			author: 'Micha L. Rieser',
			page: 'https://commons.wikimedia.org/wiki/File:Stavechurch-heddal.jpg'
		}
	},
	{
		work: 'Borgund Stave Church',
		artist: null,
		year: 'c. 1180',
		articleUrl: 'https://en.wikipedia.org/wiki/Borgund_Stave_Church',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e2/Borgund_Stave_Church_in_L%C3%A6rdalen%2C_2013_June.jpg/1280px-Borgund_Stave_Church_in_L%C3%A6rdalen%2C_2013_June.jpg',
		file: 'borgund-stave-church',
		width: 1280,
		height: 1982,
		licence: {
			name: 'CC BY-SA 3.0',
			url: 'https://creativecommons.org/licenses/by-sa/3.0',
			author: 'Simo Räsänen',
			page: 'https://commons.wikimedia.org/wiki/File:Borgund_Stave_Church_in_L%C3%A6rdalen,_2013_June.jpg'
		}
	},
	{
		work: 'Fantoft Stave Church',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Fantoft_Stave_Church',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bf/Stave_church_Fantoft.jpg/1280px-Stave_church_Fantoft.jpg',
		file: 'fantoft-stave-church',
		width: 1280,
		height: 2000,
		licence: {
			name: 'Attribution',
			url: 'https://commons.wikimedia.org/wiki/File:Stave_church_Fantoft.jpg',
			author: 'Micha L. Rieser',
			page: 'https://commons.wikimedia.org/wiki/File:Stave_church_Fantoft.jpg'
		}
	},
	{
		work: 'Urnes Stave Church',
		artist: null,
		year: 'c. 1130',
		articleUrl: 'https://en.wikipedia.org/wiki/Urnes_Stave_Church',
		sourceUrl: 'https://upload.wikimedia.org/wikipedia/commons/1/12/Urnes_Stave_Church_1.jpg',
		file: 'urnes-stave-church',
		width: 1024,
		height: 768,
		licence: {
			name: 'CC BY 2.0',
			url: 'https://creativecommons.org/licenses/by/2.0',
			author: 'Leo-setä',
			page: 'https://commons.wikimedia.org/wiki/File:Urnes_Stave_Church_1.jpg'
		}
	},
	{
		work: 'Hopperstad Stave Church',
		artist: null,
		year: 'c. 1140',
		articleUrl: 'https://en.wikipedia.org/wiki/Hopperstad_Stave_Church',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a6/Hopperstad_stave_church_2009.JPG/1280px-Hopperstad_stave_church_2009.JPG',
		file: 'hopperstad-stave-church',
		width: 1280,
		height: 1925,
		licence: {
			name: 'CC BY-SA 3.0',
			url: 'https://creativecommons.org/licenses/by-sa/3.0',
			author: 'Petr Šmerkl',
			page: 'https://commons.wikimedia.org/wiki/File:Hopperstad_stave_church_2009.JPG'
		}
	},
	{
		work: 'Kaupanger Stave Church',
		artist: null,
		year: 'c. 1140',
		articleUrl: 'https://en.wikipedia.org/wiki/Kaupanger_Stave_Church',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/6/61/Kaupanger_Stavkyrkje.JPG/1280px-Kaupanger_Stavkyrkje.JPG',
		file: 'kaupanger-stave-church',
		width: 1280,
		height: 1933,
		licence: {
			name: 'CC BY-SA 3.0',
			url: 'https://creativecommons.org/licenses/by-sa/3.0',
			author: 'Mxjanier',
			page: 'https://commons.wikimedia.org/wiki/File:Kaupanger_Stavkyrkje.JPG'
		}
	},
	{
		work: 'Undredal Stave Church',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Undredal_Stave_Church',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e7/Stabkirche_Undredal.jpg/1280px-Stabkirche_Undredal.jpg',
		file: 'undredal-stave-church',
		width: 1280,
		height: 960,
		licence: {
			name: 'CC BY-SA 3.0',
			url: 'https://creativecommons.org/licenses/by-sa/3.0',
			author: 'Aconcagua',
			page: 'https://commons.wikimedia.org/wiki/File:Stabkirche_Undredal.jpg'
		}
	},
	{
		work: 'Eidsborg Stave Church',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Eidsborg_Stave_Church',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8b/Eidsborg_Stavkyrkje.jpg/1280px-Eidsborg_Stavkyrkje.jpg',
		file: 'eidsborg-stave-church',
		width: 1280,
		height: 853,
		licence: {
			name: 'CC BY-SA 4.0',
			url: 'https://creativecommons.org/licenses/by-sa/4.0',
			author: 'Missarnold74',
			page: 'https://commons.wikimedia.org/wiki/File:Eidsborg_Stavkyrkje.jpg'
		}
	},
	{
		work: 'Røldal Stave Church',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/R%C3%B8ldal_Stave_Church',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/3/38/Staafkerk_R%C3%B8ldal.jpg/1280px-Staafkerk_R%C3%B8ldal.jpg',
		file: 'roldal-stave-church',
		width: 1280,
		height: 994
	},
	{
		work: 'Gol Stave Church',
		artist: null,
		year: 'c. 1200',
		articleUrl: 'https://en.wikipedia.org/wiki/Gol_Stave_Church',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/1/19/Gol_stavkirke.jpg/1280px-Gol_stavkirke.jpg',
		file: 'gol-stave-church',
		width: 1280,
		height: 1707,
		licence: {
			name: 'CC BY-SA 4.0',
			url: 'https://creativecommons.org/licenses/by-sa/4.0',
			author: 'Florent Pécassou',
			page: 'https://commons.wikimedia.org/wiki/File:Gol_stavkirke.jpg'
		}
	},
	{
		work: 'Ringebu Stave Church',
		artist: null,
		year: 'c. 1220',
		articleUrl: 'https://en.wikipedia.org/wiki/Ringebu_Stave_Church',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2e/Ringebu_Stave_Church.jpg/1280px-Ringebu_Stave_Church.jpg',
		file: 'ringebu-stave-church',
		width: 1280,
		height: 1280,
		licence: {
			name: 'CC BY-SA 4.0',
			url: 'https://creativecommons.org/licenses/by-sa/4.0',
			author: 'Christian David',
			page: 'https://commons.wikimedia.org/wiki/File:Ringebu_Stave_Church.jpg'
		}
	},
	{
		work: 'Hegge Stave Church',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Hegge_Stave_Church',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0a/Hegge.jpg/1280px-Hegge.jpg',
		file: 'hegge-stave-church',
		width: 1280,
		height: 1184,
		licence: {
			name: 'CC BY-SA 3.0',
			url: 'https://creativecommons.org/licenses/by-sa/3.0/',
			author: 'Johannes1024',
			page: 'https://commons.wikimedia.org/wiki/File:Hegge.jpg'
		}
	},
	{
		work: 'Old Aker Church',
		artist: null,
		year: 'c. 1080',
		articleUrl: 'https://en.wikipedia.org/wiki/Old_Aker_Church',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/3/39/Gamle_Aker_kirke_S.jpg/1280px-Gamle_Aker_kirke_S.jpg',
		file: 'old-aker-church',
		width: 1280,
		height: 854
	},
	{
		work: 'Bergen Cathedral',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Bergen_Cathedral',
		sourceUrl: 'https://upload.wikimedia.org/wikipedia/commons/1/11/Bergen_domkirken.jpg',
		file: 'bergen-cathedral',
		width: 800,
		height: 1200,
		licence: {
			name: 'CC BY-SA 2.5',
			url: 'https://creativecommons.org/licenses/by-sa/2.5',
			author: 'Morten Dreier',
			page: 'https://commons.wikimedia.org/wiki/File:Bergen_domkirken.jpg'
		}
	},
	{
		work: "St Mary's Church, Bergen",
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/St_Mary%27s_Church%2C_Bergen',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/0/06/Marienkirche_in_Bergen_01.jpg/1280px-Marienkirche_in_Bergen_01.jpg',
		file: 'st-marys-church-bergen',
		width: 1280,
		height: 2002,
		licence: {
			name: 'CC BY-SA 4.0',
			url: 'https://creativecommons.org/licenses/by-sa/4.0',
			author: 'Olaf Meister',
			page: 'https://commons.wikimedia.org/wiki/File:Marienkirche_in_Bergen_01.jpg'
		}
	},
	{
		work: 'Hagia Sophia',
		artist: null,
		year: '537',
		articleUrl: 'https://en.wikipedia.org/wiki/Hagia_Sophia',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4a/Hagia_Sophia_%28228968325%29.jpeg/1280px-Hagia_Sophia_%28228968325%29.jpeg',
		file: 'hagia-sophia',
		width: 1280,
		height: 774,
		licence: {
			name: 'CC BY-SA 3.0',
			url: 'https://creativecommons.org/licenses/by-sa/3.0',
			author: 'Adli Wahid',
			page: 'https://commons.wikimedia.org/wiki/File:Hagia_Sophia_(228968325).jpeg'
		}
	},
	{
		work: 'Notre-Dame de Paris',
		artist: null,
		year: '1163–1345',
		articleUrl: 'https://en.wikipedia.org/wiki/Notre-Dame_de_Paris',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f7/Notre-Dame_de_Paris%2C_4_October_2017.jpg/1280px-Notre-Dame_de_Paris%2C_4_October_2017.jpg',
		file: 'notre-dame-de-paris',
		width: 1280,
		height: 845
	},
	{
		work: 'Sainte-Chapelle',
		artist: null,
		year: '1242–1248',
		articleUrl: 'https://en.wikipedia.org/wiki/Sainte-Chapelle',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/7/70/Sainte_Chapelle_-_Upper_level_1.jpg',
		file: 'sainte-chapelle',
		width: 989,
		height: 1961,
		licence: {
			name: 'CC BY-SA 2.5',
			url: 'https://creativecommons.org/licenses/by-sa/2.5',
			author: 'Didier B',
			page: 'https://commons.wikimedia.org/wiki/File:Sainte_Chapelle_-_Upper_level_1.jpg'
		}
	},
	{
		work: 'Chartres Cathedral',
		artist: null,
		year: '1194–1220',
		articleUrl: 'https://en.wikipedia.org/wiki/Chartres_Cathedral',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/2/28/Notre_Dame_de_Chartres.jpg/1280px-Notre_Dame_de_Chartres.jpg',
		file: 'chartres-cathedral',
		width: 1280,
		height: 977,
		licence: {
			name: 'CC BY-SA 3.0',
			url: 'https://creativecommons.org/licenses/by-sa/3.0',
			author: 'Olvr',
			page: 'https://commons.wikimedia.org/wiki/File:Notre_Dame_de_Chartres.jpg'
		}
	},
	{
		work: 'Utstein Abbey',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Utstein_Abbey',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/9/92/Utstein_kloster_01.jpg/1280px-Utstein_kloster_01.jpg',
		file: 'utstein-abbey',
		width: 1280,
		height: 996
	},
	{
		work: 'Arctic Cathedral',
		artist: 'Jan Inge Hovig',
		year: '1965',
		articleUrl: 'https://en.wikipedia.org/wiki/Arctic_Cathedral',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d0/Arctic_Cathedral_in_Tromsoe.jpg/1280px-Arctic_Cathedral_in_Tromsoe.jpg',
		file: 'arctic-cathedral',
		width: 1280,
		height: 853,
		licence: {
			name: 'CC BY 2.5',
			url: 'https://creativecommons.org/licenses/by/2.5',
			author: 'Henrik at English Wikipedia',
			page: 'https://commons.wikimedia.org/wiki/File:Arctic_Cathedral_in_Tromsoe.jpg'
		}
	},
	{
		work: 'Lyse Abbey',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Lyse_Abbey',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/Lysekloster_garden.jpg/1280px-Lysekloster_garden.jpg',
		file: 'lyse-abbey',
		width: 1280,
		height: 853,
		licence: {
			name: 'CC BY-SA 3.0',
			url: 'https://creativecommons.org/licenses/by-sa/3.0/',
			author: 'Lm-berlin',
			page: 'https://commons.wikimedia.org/wiki/File:Lysekloster_garden.jpg'
		}
	},
	{
		work: 'Halsnøy Abbey',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Halsn%C3%B8y_Abbey',
		sourceUrl: 'https://upload.wikimedia.org/wikipedia/commons/8/8a/Halsnoey-190-k6.jpg',
		file: 'halsnoy-abbey',
		width: 600,
		height: 453,
		licence: {
			name: 'CC BY-SA 3.0',
			url: 'https://creativecommons.org/licenses/by-sa/3.0/',
			author: 'Saxo',
			page: 'https://commons.wikimedia.org/wiki/File:Halsnoey-190-k6.jpg'
		}
	},
	{
		work: 'Selja Abbey',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Selja_Abbey',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/Selje_kloster_Nordfjord.jpg/1280px-Selje_kloster_Nordfjord.jpg',
		file: 'selja-abbey',
		width: 1280,
		height: 853,
		licence: {
			name: 'CC BY-SA 3.0',
			url: 'https://creativecommons.org/licenses/by-sa/3.0',
			author: 'Kremle',
			page: 'https://commons.wikimedia.org/wiki/File:Selje_kloster_Nordfjord.jpg'
		}
	},
	{
		work: 'Værnes Church',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/V%C3%A6rnes_Church',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b0/Vaernes_kyrkje.jpg/1280px-Vaernes_kyrkje.jpg',
		file: 'varnes-church',
		width: 1280,
		height: 960,
		licence: {
			name: 'CC BY-SA 3.0',
			url: 'https://creativecommons.org/licenses/by-sa/3.0',
			author: 'Dag Bertelsen',
			page: 'https://commons.wikimedia.org/wiki/File:Vaernes_kyrkje.jpg'
		}
	},
	{
		work: 'Hove Church',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Hove_Church',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/9/98/Hove_kirke%2C_2016-3.jpg/1280px-Hove_kirke%2C_2016-3.jpg',
		file: 'hove-church',
		width: 1280,
		height: 800,
		licence: {
			name: 'CC BY-SA 4.0',
			url: 'https://creativecommons.org/licenses/by-sa/4.0',
			author: 'Bjørn Erik Pedersen',
			page: 'https://commons.wikimedia.org/wiki/File:Hove_kirke,_2016-3.jpg'
		}
	},
	{
		work: 'Fitjar Church',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Fitjar_Church',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/2/20/Fitjar_kirke.jpg/1280px-Fitjar_kirke.jpg',
		file: 'fitjar-church',
		width: 1280,
		height: 1034,
		licence: {
			name: 'CC BY-SA 3.0',
			url: 'https://creativecommons.org/licenses/by-sa/3.0/',
			author: 'Svein Harkestad',
			page: 'https://commons.wikimedia.org/wiki/File:Fitjar_kirke.jpg'
		}
	},
	{
		work: 'Stord Church',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Stord_Church',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/2/29/Stord_kirke.jpg/1280px-Stord_kirke.jpg',
		file: 'stord-church',
		width: 1280,
		height: 911,
		licence: {
			name: 'CC BY-SA 3.0',
			url: 'https://creativecommons.org/licenses/by-sa/3.0',
			author: 'Jarvin',
			page: 'https://commons.wikimedia.org/wiki/File:Stord_kirke.jpg'
		}
	},
	{
		work: 'Kvinnherad Church',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Kvinnherad_Church',
		sourceUrl: 'https://upload.wikimedia.org/wikipedia/commons/0/09/Kvinnheradkirke04.JPG',
		file: 'kvinnherad-church',
		width: 1280,
		height: 960,
		licence: {
			name: 'CC BY-SA 2.5',
			url: 'https://creativecommons.org/licenses/by-sa/2.5',
			author: 'Tomasz Halszka',
			page: 'https://commons.wikimedia.org/wiki/File:Kvinnheradkirke04.JPG'
		}
	},
	{
		work: 'Old Tingelstad Church',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Old_Tingelstad_Church',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a2/Tingelstad_old_church%2C_south-east_side%2C_2008-06-01.jpg/1280px-Tingelstad_old_church%2C_south-east_side%2C_2008-06-01.jpg',
		file: 'old-tingelstad-church',
		width: 1280,
		height: 857
	},
	{
		work: 'Church of the Holy Sepulchre',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Church_of_the_Holy_Sepulchre',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6d/Church_of_the_Holy_Sepulchre_by_Gerd_Eichmann_%28cropped%29.jpg/1280px-Church_of_the_Holy_Sepulchre_by_Gerd_Eichmann_%28cropped%29.jpg',
		file: 'church-of-the-holy-sepulchre',
		width: 1280,
		height: 834,
		licence: {
			name: 'CC BY-SA 4.0',
			url: 'https://creativecommons.org/licenses/by-sa/4.0',
			author: 'Gerd Eichmann',
			page: 'https://commons.wikimedia.org/wiki/File:Church_of_the_Holy_Sepulchre_by_Gerd_Eichmann_(cropped).jpg'
		}
	},
	{
		work: 'Lindisfarne',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Lindisfarne',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/Holy_Island_Sunrise_%28again%29_%2815064111624%29.jpg/1280px-Holy_Island_Sunrise_%28again%29_%2815064111624%29.jpg',
		file: 'lindisfarne',
		width: 1280,
		height: 854,
		licence: {
			name: 'CC BY 2.0',
			url: 'https://creativecommons.org/licenses/by/2.0',
			author: 'Chris Combe',
			page: 'https://commons.wikimedia.org/wiki/File:Holy_Island_Sunrise_(again)_(15064111624).jpg'
		}
	},
	{
		work: 'Westminster Abbey',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Westminster_Abbey',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/Westminster_Abbey%2C_Westminster.jpg/1280px-Westminster_Abbey%2C_Westminster.jpg',
		file: 'westminster-abbey',
		width: 1280,
		height: 2573,
		licence: {
			name: 'CC BY 4.0',
			url: 'https://creativecommons.org/licenses/by/4.0',
			author: 'Antiquary',
			page: 'https://commons.wikimedia.org/wiki/File:Westminster_Abbey,_Westminster.jpg'
		}
	},
	{
		work: 'Sagrada Família',
		artist: 'Antoni Gaudí',
		year: '1882–',
		articleUrl: 'https://en.wikipedia.org/wiki/Sagrada_Fam%C3%ADlia',
		sourceUrl: 'https://upload.wikimedia.org/wikipedia/commons/e/ef/SF_maig_2_cropped.jpg',
		file: 'sagrada-familia',
		width: 1227,
		height: 1786,
		licence: {
			name: 'CC BY-SA 4.0',
			url: 'https://creativecommons.org/licenses/by-sa/4.0',
			author: 'Canaan',
			page: 'https://commons.wikimedia.org/wiki/File:SF_maig_2_cropped.jpg'
		}
	},
	{
		work: 'Fountains Abbey',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Fountains_Abbey',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/5/53/Studley_Royal_Park_-_Fountains_Abbey_-_02.jpg/1280px-Studley_Royal_Park_-_Fountains_Abbey_-_02.jpg',
		file: 'fountains-abbey',
		width: 1280,
		height: 960,
		licence: {
			name: 'CC BY-SA 4.0',
			url: 'https://creativecommons.org/licenses/by-sa/4.0',
			author: 'Benjamin Smith',
			page: 'https://commons.wikimedia.org/wiki/File:Studley_Royal_Park_-_Fountains_Abbey_-_02.jpg'
		}
	},
	{
		work: 'Salisbury Cathedral',
		artist: null,
		year: '1220–1258',
		articleUrl: 'https://en.wikipedia.org/wiki/Salisbury_Cathedral',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/7/7f/SalisburyCathedral-wyrdlight-EastExt.jpg',
		file: 'salisbury-cathedral',
		width: 1100,
		height: 908,
		licence: {
			name: 'CC BY-SA 4.0',
			url: 'https://creativecommons.org/licenses/by-sa/4.0',
			author: 'Antony McCallum',
			page: 'https://commons.wikimedia.org/wiki/File:SalisburyCathedral-wyrdlight-EastExt.jpg'
		}
	},
	{
		work: 'Canterbury Cathedral',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Canterbury_Cathedral',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/8/80/Canterbury_Cathedral_evening_%284902497028%29.jpg/1280px-Canterbury_Cathedral_evening_%284902497028%29.jpg',
		file: 'canterbury-cathedral',
		width: 1280,
		height: 1532,
		licence: {
			name: 'CC BY 2.0',
			url: 'https://creativecommons.org/licenses/by/2.0',
			author: 'Tony Hisgett',
			page: 'https://commons.wikimedia.org/wiki/File:Canterbury_Cathedral_evening_(4902497028).jpg'
		}
	},
	{
		work: "St. Peter's Basilica",
		artist: null,
		year: '1506–1626',
		articleUrl: 'https://en.wikipedia.org/wiki/St._Peter%27s_Basilica',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f5/Basilica_di_San_Pietro_in_Vaticano_September_2015-1a.jpg/1280px-Basilica_di_San_Pietro_in_Vaticano_September_2015-1a.jpg',
		file: 'st-peters-basilica',
		width: 1280,
		height: 668,
		licence: {
			name: 'CC BY-SA 4.0',
			url: 'https://creativecommons.org/licenses/by-sa/4.0',
			author: 'Alvesgaspar',
			page: 'https://commons.wikimedia.org/wiki/File:Basilica_di_San_Pietro_in_Vaticano_September_2015-1a.jpg'
		}
	},
	{
		work: 'Cologne Cathedral',
		artist: null,
		year: '1248–1880',
		articleUrl: 'https://en.wikipedia.org/wiki/Cologne_Cathedral',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/0/04/K%C3%B6lner_Dom_-_Westfassade_2022_ohne_Ger%C3%BCst-0968_b.jpg/1280px-K%C3%B6lner_Dom_-_Westfassade_2022_ohne_Ger%C3%BCst-0968_b.jpg',
		file: 'cologne-cathedral',
		width: 1280,
		height: 2077,
		licence: {
			name: 'CC BY-SA 4.0',
			url: 'https://creativecommons.org/licenses/by-sa/4.0',
			author: 'Raimond Spekking',
			page: 'https://commons.wikimedia.org/wiki/File:K%C3%B6lner_Dom_-_Westfassade_2022_ohne_Ger%C3%BCst-0968_b.jpg'
		}
	},
	{
		work: 'Meteora',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Meteora',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7c/Meteora%27s_monastery_2.jpg/1280px-Meteora%27s_monastery_2.jpg',
		file: 'meteora',
		width: 1280,
		height: 854,
		licence: {
			name: 'CC BY-SA 4.0',
			url: 'https://creativecommons.org/licenses/by-sa/4.0',
			author: 'Stathis Floros',
			page: 'https://commons.wikimedia.org/wiki/File:Meteora%27s_monastery_2.jpg'
		}
	},
	{
		work: 'Rievaulx Abbey',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Rievaulx_Abbey',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/0/06/RievaulxAbbey-wyrdlight-24588.jpg/1280px-RievaulxAbbey-wyrdlight-24588.jpg',
		file: 'rievaulx-abbey',
		width: 1280,
		height: 853,
		licence: {
			name: 'CC BY-SA 3.0',
			url: 'https://creativecommons.org/licenses/by-sa/3.0',
			author: 'Antony McCallum / WyrdLight.com',
			page: 'https://commons.wikimedia.org/wiki/File:RievaulxAbbey-wyrdlight-24588.jpg'
		}
	},
	{
		work: 'Durham Cathedral',
		artist: null,
		year: '1093–1133',
		articleUrl: 'https://en.wikipedia.org/wiki/Durham_Cathedral',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d6/Durham_MMB_02_Cathedral.jpg/1280px-Durham_MMB_02_Cathedral.jpg',
		file: 'durham-cathedral',
		width: 1280,
		height: 772,
		licence: {
			name: 'CC BY-SA 4.0',
			url: 'https://creativecommons.org/licenses/by-sa/4.0',
			author: 'mattbuck',
			page: 'https://commons.wikimedia.org/wiki/File:Durham_MMB_02_Cathedral.jpg'
		}
	},
	{
		work: 'Skellig Michael',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Skellig_Michael',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d8/Skellig_Michael03%28js%29.jpg/1280px-Skellig_Michael03%28js%29.jpg',
		file: 'skellig-michael',
		width: 1280,
		height: 833,
		licence: {
			name: 'CC BY-SA 3.0',
			url: 'https://creativecommons.org/licenses/by-sa/3.0',
			author: 'Jerzy Strzelecki',
			page: 'https://commons.wikimedia.org/wiki/File:Skellig_Michael03(js).jpg'
		}
	},
	{
		work: 'Tintern Abbey',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Tintern_Abbey',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/2/23/TinternAbbey_WestEnd.jpg/1280px-TinternAbbey_WestEnd.jpg',
		file: 'tintern-abbey',
		width: 1280,
		height: 923,
		licence: {
			name: 'CC BY-SA 4.0',
			url: 'https://creativecommons.org/licenses/by-sa/4.0',
			author: 'Martinvl',
			page: 'https://commons.wikimedia.org/wiki/File:TinternAbbey_WestEnd.jpg'
		}
	},
	{
		work: 'Mont-Saint-Michel',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Mont-Saint-Michel',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/7/78/Mont-Saint-Michel_vu_du_ciel.jpg/1280px-Mont-Saint-Michel_vu_du_ciel.jpg',
		file: 'mont-saint-michel',
		width: 1280,
		height: 720,
		licence: {
			name: 'CC BY-SA 4.0',
			url: 'https://creativecommons.org/licenses/by-sa/4.0',
			author: 'Amaustan',
			page: 'https://commons.wikimedia.org/wiki/File:Mont-Saint-Michel_vu_du_ciel.jpg'
		}
	},
	{
		work: "Saint Catherine's Monastery",
		artist: null,
		year: '548–565',
		articleUrl: 'https://en.wikipedia.org/wiki/Saint_Catherine%27s_Monastery',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6b/Katharinenkloster_Sinai_BW_2.jpg/1280px-Katharinenkloster_Sinai_BW_2.jpg',
		file: 'saint-catherines-monastery',
		width: 1280,
		height: 857,
		licence: {
			name: 'CC BY-SA 3.0',
			url: 'https://creativecommons.org/licenses/by-sa/3.0',
			author: 'Berthold Werner',
			page: 'https://commons.wikimedia.org/wiki/File:Katharinenkloster_Sinai_BW_2.jpg'
		}
	},
	{
		work: 'Rila Monastery',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Rila_Monastery',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/4/46/Rila_Monastery%2C_August_2013.jpg/1280px-Rila_Monastery%2C_August_2013.jpg',
		file: 'rila-monastery',
		width: 1280,
		height: 853,
		licence: {
			name: 'CC BY-SA 3.0',
			url: 'https://creativecommons.org/licenses/by-sa/3.0',
			author: 'Raggatt2000',
			page: 'https://commons.wikimedia.org/wiki/File:Rila_Monastery,_August_2013.jpg'
		}
	},
	{
		work: "King's College Chapel, Cambridge",
		artist: null,
		year: '1446–1515',
		articleUrl: 'https://en.wikipedia.org/wiki/King%27s_College_Chapel%2C_Cambridge',
		sourceUrl: 'https://upload.wikimedia.org/wikipedia/commons/f/fd/KingsCollegeChapel.jpg',
		file: 'kings-college-chapel-cambridge',
		width: 982,
		height: 709,
		licence: {
			name: 'CC BY-SA 3.0',
			url: 'https://creativecommons.org/licenses/by-sa/3.0/',
			author: 'Christian Richardt',
			page: 'https://commons.wikimedia.org/wiki/File:KingsCollegeChapel.jpg'
		}
	},
	{
		work: 'Santiago de Compostela Cathedral',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Santiago_de_Compostela_Cathedral',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/Santiago_cathedral_2021.jpg/1280px-Santiago_cathedral_2021.jpg',
		file: 'santiago-de-compostela-cathedral',
		width: 1280,
		height: 1600,
		licence: {
			name: 'CC BY-SA 4.0',
			url: 'https://creativecommons.org/licenses/by-sa/4.0',
			author: 'Fernando',
			page: 'https://commons.wikimedia.org/wiki/File:Santiago_cathedral_2021.jpg'
		}
	},
	{
		work: 'Iona Abbey',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Iona_Abbey',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/8/80/Iona_Abbey_%2845322644484%29.jpg/1280px-Iona_Abbey_%2845322644484%29.jpg',
		file: 'iona-abbey',
		width: 1280,
		height: 960,
		licence: {
			name: 'CC BY 2.0',
			url: 'https://creativecommons.org/licenses/by/2.0',
			author: 'Reading Tom',
			page: 'https://commons.wikimedia.org/wiki/File:Iona_Abbey_(45322644484).jpg'
		}
	},
	{
		work: 'Church of the Nativity',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Church_of_the_Nativity',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/6/61/Church_of_the_Nativity_%287703592746%29.jpg/1280px-Church_of_the_Nativity_%287703592746%29.jpg',
		file: 'church-of-the-nativity',
		width: 1280,
		height: 850,
		licence: {
			name: 'CC BY 2.0',
			url: 'https://creativecommons.org/licenses/by/2.0',
			author: 'Neil Ward',
			page: 'https://commons.wikimedia.org/wiki/File:Church_of_the_Nativity_(7703592746).jpg'
		}
	},
	{
		work: 'Sistine Chapel',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Sistine_Chapel',
		sourceUrl: 'https://upload.wikimedia.org/wikipedia/commons/8/82/Sistina-interno.jpg',
		file: 'sistine-chapel',
		width: 782,
		height: 1062,
		licence: {
			name: 'CC BY-SA 3.0',
			url: 'https://creativecommons.org/licenses/by-sa/3.0/',
			author: 'Snowdog',
			page: 'https://commons.wikimedia.org/wiki/File:Sistina-interno.jpg'
		}
	},
	{
		work: "Saint Basil's Cathedral",
		artist: null,
		year: '1555–1561',
		articleUrl: 'https://en.wikipedia.org/wiki/Saint_Basil%27s_Cathedral',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/1/18/Saint_Basil%27s_Cathedral_in_Moscow.jpg/1280px-Saint_Basil%27s_Cathedral_in_Moscow.jpg',
		file: 'saint-basils-cathedral',
		width: 1280,
		height: 1420,
		licence: {
			name: 'CC BY-SA 4.0',
			url: 'https://creativecommons.org/licenses/by-sa/4.0',
			author: 'Tsy1980',
			page: 'https://commons.wikimedia.org/wiki/File:Saint_Basil%27s_Cathedral_in_Moscow.jpg'
		}
	},
	{
		work: "St Mark's Basilica",
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/St_Mark%27s_Basilica',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/6/61/Venezia_Basilica_di_San_Marco_Fassade_2.jpg/1280px-Venezia_Basilica_di_San_Marco_Fassade_2.jpg',
		file: 'st-marks-basilica',
		width: 1280,
		height: 858
	},
	{
		work: 'Aachen Cathedral',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Aachen_Cathedral',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/b/be/Aachen_Germany_Imperial-Cathedral-01.jpg/1280px-Aachen_Germany_Imperial-Cathedral-01.jpg',
		file: 'aachen-cathedral',
		width: 1280,
		height: 914,
		licence: {
			name: 'CC BY-SA 3.0',
			url: 'https://creativecommons.org/licenses/by-sa/3.0',
			author: 'CEphoto, Uwe Aranas',
			page: 'https://commons.wikimedia.org/wiki/File:Aachen_Germany_Imperial-Cathedral-01.jpg'
		}
	},
	{
		work: 'Florence Cathedral',
		artist: null,
		year: '1296–1436',
		articleUrl: 'https://en.wikipedia.org/wiki/Florence_Cathedral',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c7/Cattedrale_di_Santa_Maria_del_Fiore_%E2%80%93_Il_Duomo_di_Firenze.jpg/1280px-Cattedrale_di_Santa_Maria_del_Fiore_%E2%80%93_Il_Duomo_di_Firenze.jpg',
		file: 'florence-cathedral',
		width: 1280,
		height: 857,
		licence: {
			name: 'CC BY 2.0',
			url: 'https://creativecommons.org/licenses/by/2.0',
			author: 'Gary Campbell-Hall',
			page: 'https://commons.wikimedia.org/wiki/File:Cattedrale_di_Santa_Maria_del_Fiore_%E2%80%93_Il_Duomo_di_Firenze.jpg'
		}
	},
	{
		work: 'Milan Cathedral',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Milan_Cathedral',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/7/70/Milan_Cathedral_from_Piazza_del_Duomo.jpg/1280px-Milan_Cathedral_from_Piazza_del_Duomo.jpg',
		file: 'milan-cathedral',
		width: 1280,
		height: 962,
		licence: {
			name: 'CC BY-SA 3.0',
			url: 'https://creativecommons.org/licenses/by-sa/3.0',
			author: 'Jiuguang Wang',
			page: 'https://commons.wikimedia.org/wiki/File:Milan_Cathedral_from_Piazza_del_Duomo.jpg'
		}
	},
	{
		work: 'Melk Abbey',
		artist: 'Jakob Prandtauer',
		year: '1702–1736',
		articleUrl: 'https://en.wikipedia.org/wiki/Melk_Abbey',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2d/Stift_Melk%2C_Westansicht.jpg/1280px-Stift_Melk%2C_Westansicht.jpg',
		file: 'melk-abbey',
		width: 1280,
		height: 853,
		licence: {
			name: 'CC BY-SA 4.0',
			url: 'https://creativecommons.org/licenses/by-sa/4.0',
			author: 'Thomas Ledl',
			page: 'https://commons.wikimedia.org/wiki/File:Stift_Melk,_Westansicht.jpg'
		}
	},
	{
		work: 'Strasbourg Cathedral',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Strasbourg_Cathedral',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7e/Strasbourg_Cathedral_Exterior_-_Diliff.jpg/1280px-Strasbourg_Cathedral_Exterior_-_Diliff.jpg',
		file: 'strasbourg-cathedral',
		width: 1280,
		height: 1636,
		licence: {
			name: 'CC BY-SA 3.0',
			url: 'https://creativecommons.org/licenses/by-sa/3.0',
			author: 'Diliff',
			page: 'https://commons.wikimedia.org/wiki/File:Strasbourg_Cathedral_Exterior_-_Diliff.jpg'
		}
	},
	{
		work: 'Jerónimos Monastery',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Jer%C3%B3nimos_Monastery',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0e/1502_legte_K%C3%B6nig_Manuel_I._den_Grundstein_f%C3%BCr_das_Hieronymus_Kloster_in_Lissabon._06.jpg/1280px-1502_legte_K%C3%B6nig_Manuel_I._den_Grundstein_f%C3%BCr_das_Hieronymus_Kloster_in_Lissabon._06.jpg',
		file: 'jeronimos-monastery',
		width: 1280,
		height: 769,
		licence: {
			name: 'CC BY-SA 4.0',
			url: 'https://creativecommons.org/licenses/by-sa/4.0',
			author: 'Holger Uwe Schmitt',
			page: 'https://commons.wikimedia.org/wiki/File:1502_legte_K%C3%B6nig_Manuel_I._den_Grundstein_f%C3%BCr_das_Hieronymus_Kloster_in_Lissabon._06.jpg'
		}
	},
	{
		work: 'Amiens Cathedral',
		artist: null,
		year: '1220–1270',
		articleUrl: 'https://en.wikipedia.org/wiki/Amiens_Cathedral',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2c/0_Amiens_-_Cath%C3%A9drale_Notre-Dame_%281%29.JPG/1280px-0_Amiens_-_Cath%C3%A9drale_Notre-Dame_%281%29.JPG',
		file: 'amiens-cathedral',
		width: 1280,
		height: 1964,
		licence: {
			name: 'CC BY 3.0',
			url: 'https://creativecommons.org/licenses/by/3.0',
			author: 'Jean-Pol Grandmont',
			page: 'https://commons.wikimedia.org/wiki/File:0_Amiens_-_Cath%C3%A9drale_Notre-Dame_(1).JPG'
		}
	},
	{
		work: 'Seville Cathedral',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Seville_Cathedral',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2b/Sevilla_Cathedral_-_Southeast.jpg/1280px-Sevilla_Cathedral_-_Southeast.jpg',
		file: 'seville-cathedral',
		width: 1280,
		height: 954,
		licence: {
			name: 'CC BY-SA 4.0',
			url: 'https://creativecommons.org/licenses/by-sa/4.0',
			author: 'Ingo Mehling',
			page: 'https://commons.wikimedia.org/wiki/File:Sevilla_Cathedral_-_Southeast.jpg'
		}
	},
	{
		work: 'Burgos Cathedral',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Burgos_Cathedral',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8e/FP_Burgos_Cathedral_2026_-_West_Fa%C3%A7ade.jpg/1280px-FP_Burgos_Cathedral_2026_-_West_Fa%C3%A7ade.jpg',
		file: 'burgos-cathedral',
		width: 1280,
		height: 1280,
		licence: {
			name: 'CC BY-SA 4.0',
			url: 'https://creativecommons.org/licenses/by-sa/4.0',
			author: 'Fernando',
			page: 'https://commons.wikimedia.org/wiki/File:FP_Burgos_Cathedral_2026_-_West_Fa%C3%A7ade.jpg'
		}
	},
	{
		work: 'Batalha Monastery',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Batalha_Monastery',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/5/54/Batalha_September_2021-53.jpg/1280px-Batalha_September_2021-53.jpg',
		file: 'batalha-monastery',
		width: 1280,
		height: 722,
		licence: {
			name: 'CC BY-SA 4.0',
			url: 'https://creativecommons.org/licenses/by-sa/4.0',
			author: 'Alvesgaspar',
			page: 'https://commons.wikimedia.org/wiki/File:Batalha_September_2021-53.jpg'
		}
	},
	{
		work: 'Kizhi Pogost',
		artist: null,
		year: '1714',
		articleUrl: 'https://en.wikipedia.org/wiki/Kizhi_Pogost',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/d/de/Kizhi_06-2017_img08_Pogost_view.jpg/1280px-Kizhi_06-2017_img08_Pogost_view.jpg',
		file: 'kizhi-pogost',
		width: 1280,
		height: 720,
		licence: {
			name: 'FAL',
			url: 'https://artlibre.org/licence/lal/en',
			author: 'A.Savin',
			page: 'https://commons.wikimedia.org/wiki/File:Kizhi_06-2017_img08_Pogost_view.jpg'
		}
	},
	{
		work: 'Basilica of Saint Francis of Assisi',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Basilica_of_Saint_Francis_of_Assisi',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d9/Assisi_San_Francesco_BW_2.JPG/1280px-Assisi_San_Francesco_BW_2.JPG',
		file: 'basilica-of-saint-francis-of-assisi',
		width: 1280,
		height: 854
	},
	{
		work: 'Basilica of San Vitale',
		artist: null,
		year: '526–547',
		articleUrl: 'https://en.wikipedia.org/wiki/Basilica_of_San_Vitale',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/5/51/Basilica_of_San_Vitale.jpg/1280px-Basilica_of_San_Vitale.jpg',
		file: 'basilica-of-san-vitale',
		width: 1280,
		height: 1172,
		licence: {
			name: 'CC BY-SA 4.0',
			url: 'https://creativecommons.org/licenses/by-sa/4.0',
			author: 'Commonists',
			page: 'https://commons.wikimedia.org/wiki/File:Basilica_of_San_Vitale.jpg'
		}
	},
	{
		work: 'Monreale Cathedral',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Monreale_Cathedral',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ac/%22Die_Kathedrale_zeigt_in_besonders_eindrucksvoller_Weise_den_normannisch-arabisch-byzantinischen_Baustil%22_02.jpg/1280px-%22Die_Kathedrale_zeigt_in_besonders_eindrucksvoller_Weise_den_normannisch-arabisch-byzantinischen_Baustil%22_02.jpg',
		file: 'monreale-cathedral',
		width: 1280,
		height: 869,
		licence: {
			name: 'CC BY-SA 4.0',
			url: 'https://creativecommons.org/licenses/by-sa/4.0',
			author: 'Holger Uwe Schmitt',
			page: 'https://commons.wikimedia.org/wiki/File:%22Die_Kathedrale_zeigt_in_besonders_eindrucksvoller_Weise_den_normannisch-arabisch-byzantinischen_Baustil%22_02.jpg'
		}
	},
	{
		work: 'Speyer Cathedral',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Speyer_Cathedral',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c7/Speyer_dom_11.jpg/1280px-Speyer_dom_11.jpg',
		file: 'speyer-cathedral',
		width: 1280,
		height: 853,
		licence: {
			name: 'CC BY-SA 3.0',
			url: 'https://creativecommons.org/licenses/by-sa/3.0',
			author: 'Sail over',
			page: 'https://commons.wikimedia.org/wiki/File:Speyer_dom_11.jpg'
		}
	},
	{
		work: 'Reims Cathedral',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Reims_Cathedral',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/7/70/Exterior_view_of_the_west_facade_of_Notre-Dame_Cathedral_in_Reims.jpg/1280px-Exterior_view_of_the_west_facade_of_Notre-Dame_Cathedral_in_Reims.jpg',
		file: 'reims-cathedral',
		width: 1280,
		height: 1991,
		licence: {
			name: 'CC BY-SA 4.0',
			url: 'https://creativecommons.org/licenses/by-sa/4.0',
			author: 'Gennadii Saus i Segura',
			page: 'https://commons.wikimedia.org/wiki/File:Exterior_view_of_the_west_facade_of_Notre-Dame_Cathedral_in_Reims.jpg'
		}
	},
	{
		work: 'Lindisfarne Gospels',
		artist: 'Eadfrith of Lindisfarne',
		year: 'c. 715',
		articleUrl: 'https://en.wikipedia.org/wiki/Lindisfarne_Gospels',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/d/d2/LindisfarneFol27rIncipitMatt.jpg',
		file: 'lindisfarne-gospels',
		width: 1266,
		height: 1797
	},
	{
		work: 'Book of Kells',
		artist: null,
		year: 'c. 800',
		articleUrl: 'https://en.wikipedia.org/wiki/Book_of_Kells',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b1/KellsFol032vChristEnthroned.jpg/1280px-KellsFol032vChristEnthroned.jpg',
		file: 'book-of-kells',
		width: 1280,
		height: 1668
	},
	{
		work: 'Wieskirche',
		artist: 'Dominikus Zimmermann',
		year: '1745–1754',
		articleUrl: 'https://en.wikipedia.org/wiki/Wieskirche',
		sourceUrl: 'https://upload.wikimedia.org/wikipedia/commons/6/6e/Wieskirche_003.JPG',
		file: 'wieskirche',
		width: 1200,
		height: 900
	},
	{
		work: 'Studenica Monastery',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Studenica_Monastery',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/0/01/Manastir_Studenica%2C_Bogorodi%C4%8Dina_crkva_sa_ulaznim_portalom.jpg/1280px-Manastir_Studenica%2C_Bogorodi%C4%8Dina_crkva_sa_ulaznim_portalom.jpg',
		file: 'studenica-monastery',
		width: 1280,
		height: 853,
		licence: {
			name: 'CC BY-SA 4.0',
			url: 'https://creativecommons.org/licenses/by-sa/4.0',
			author: 'DjordjeMarkovic',
			page: 'https://commons.wikimedia.org/wiki/File:Manastir_Studenica,_Bogorodi%C4%8Dina_crkva_sa_ulaznim_portalom.jpg'
		}
	},
	{
		work: 'Book of Durrow',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Book_of_Durrow',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c8/IE_TCD_MS_57_f.86r.jpg/1280px-IE_TCD_MS_57_f.86r.jpg',
		file: 'book-of-durrow',
		width: 1280,
		height: 1756,
		licence: {
			name: 'CC BY 4.0',
			url: 'https://creativecommons.org/licenses/by/4.0',
			author: 'Trinity College Dublin Library',
			page: 'https://commons.wikimedia.org/wiki/File:IE_TCD_MS_57_f.86r.jpg'
		}
	},
	{
		work: 'Church of Saint George, Lalibela',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Church_of_Saint_George%2C_Lalibela',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/a/aa/Lalibela%2C_san_giorgio%2C_esterno_24.jpg/1280px-Lalibela%2C_san_giorgio%2C_esterno_24.jpg',
		file: 'church-of-saint-george-lalibela',
		width: 1280,
		height: 1109,
		licence: {
			name: 'CC BY 3.0',
			url: 'https://creativecommons.org/licenses/by/3.0',
			author: 'Sailko',
			page: 'https://commons.wikimedia.org/wiki/File:Lalibela,_san_giorgio,_esterno_24.jpg'
		}
	},
	{
		work: 'Lund Cathedral',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Lund_Cathedral',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/a/aa/Lunds_domkyrka_augusti_2012.jpg/1280px-Lunds_domkyrka_augusti_2012.jpg',
		file: 'lund-cathedral',
		width: 1280,
		height: 1204,
		licence: {
			name: 'CC BY-SA 3.0',
			url: 'https://creativecommons.org/licenses/by-sa/3.0',
			author: 'Jorchr',
			page: 'https://commons.wikimedia.org/wiki/File:Lunds_domkyrka_augusti_2012.jpg'
		}
	},
	{
		work: 'Uppsala Cathedral',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Uppsala_Cathedral',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2e/Uppsala_domkyrka%2C_flygbild.jpg/1280px-Uppsala_domkyrka%2C_flygbild.jpg',
		file: 'uppsala-cathedral',
		width: 1280,
		height: 851,
		licence: {
			name: 'CC BY-SA 4.0',
			url: 'https://creativecommons.org/licenses/by-sa/4.0',
			author: 'Kateryna Baiduzha',
			page: 'https://commons.wikimedia.org/wiki/File:Uppsala_domkyrka,_flygbild.jpg'
		}
	},
	{
		work: 'Helsinki Cathedral',
		artist: 'Carl Ludvig Engel',
		year: '1830–1852',
		articleUrl: 'https://en.wikipedia.org/wiki/Helsinki_Cathedral',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7d/Kirkko3.png/1280px-Kirkko3.png',
		file: 'helsinki-cathedral',
		width: 1280,
		height: 903
	},
	{
		work: 'Etchmiadzin Cathedral',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Etchmiadzin_Cathedral',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/3/34/Etchmiadzin_2025-3.jpg/1280px-Etchmiadzin_2025-3.jpg',
		file: 'etchmiadzin-cathedral',
		width: 1280,
		height: 964,
		licence: {
			name: 'CC BY 4.0',
			url: 'https://creativecommons.org/licenses/by/4.0',
			author: 'Yerevantsi',
			page: 'https://commons.wikimedia.org/wiki/File:Etchmiadzin_2025-3.jpg'
		}
	},
	{
		work: 'Geghard',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Geghard',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/Monasterio_de_Geghard%2C_Armenia%2C_2016-10-02%2C_DD_63.jpg/1280px-Monasterio_de_Geghard%2C_Armenia%2C_2016-10-02%2C_DD_63.jpg',
		file: 'geghard',
		width: 1280,
		height: 835,
		licence: {
			name: 'CC BY-SA 4.0',
			url: 'https://creativecommons.org/licenses/by-sa/4.0',
			author: 'Diego Delso',
			page: 'https://commons.wikimedia.org/wiki/File:Monasterio_de_Geghard,_Armenia,_2016-10-02,_DD_63.jpg'
		}
	},
	{
		work: 'Hallgrímskirkja',
		artist: 'Guðjón Samúelsson',
		year: '1945–1986',
		articleUrl: 'https://en.wikipedia.org/wiki/Hallgr%C3%ADmskirkja',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8b/Hallgrimskirkja_mai_2026.jpg/1280px-Hallgrimskirkja_mai_2026.jpg',
		file: 'hallgrimskirkja',
		width: 1280,
		height: 1124,
		licence: {
			name: 'CC BY 4.0',
			url: 'https://creativecommons.org/licenses/by/4.0',
			author: 'Steinninn',
			page: 'https://commons.wikimedia.org/wiki/File:Hallgrimskirkja_mai_2026.jpg'
		}
	},
	{
		work: 'Sumela Monastery',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Sumela_Monastery',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/d/db/Sumela_From_Across_Valley.JPG/1280px-Sumela_From_Across_Valley.JPG',
		file: 'sumela-monastery',
		width: 1280,
		height: 506,
		licence: {
			name: 'CC BY-SA 3.0',
			url: 'https://creativecommons.org/licenses/by-sa/3.0',
			author: 'Bjørn Christian Tørrissen',
			page: 'https://commons.wikimedia.org/wiki/File:Sumela_From_Across_Valley.JPG'
		}
	},
	{
		work: 'Roskilde Cathedral',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Roskilde_Cathedral',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d9/Roskilde_Cathedral_aerial_crop.jpg/1280px-Roskilde_Cathedral_aerial_crop.jpg',
		file: 'roskilde-cathedral',
		width: 1280,
		height: 1693,
		licence: {
			name: 'CC BY-SA 4.0',
			url: 'https://creativecommons.org/licenses/by-sa/4.0',
			author: 'CucombreLibre',
			page: 'https://commons.wikimedia.org/wiki/File:Roskilde_Cathedral_aerial_crop.jpg'
		}
	},
	{
		work: 'Visoki Dečani',
		artist: null,
		year: '1327–1335',
		articleUrl: 'https://en.wikipedia.org/wiki/Visoki_De%C4%8Dani',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0d/Manastir_Visoki_De%C4%8Dani_%28%D0%9C%D0%B0%D0%BD%D0%B0%D1%81%D1%82%D0%B8%D1%80_%D0%92%D0%B8%D1%81%D0%BE%D0%BA%D0%B8_%D0%94%D0%B5%D1%87%D0%B0%D0%BD%D0%B8%29_-_by_Pudelek..jpg/1280px-Manastir_Visoki_De%C4%8Dani_%28%D0%9C%D0%B0%D0%BD%D0%B0%D1%81%D1%82%D0%B8%D1%80_%D0%92%D0%B8%D1%81%D0%BE%D0%BA%D0%B8_%D0%94%D0%B5%D1%87%D0%B0%D0%BD%D0%B8%29_-_by_Pudelek..jpg',
		file: 'visoki-decani',
		width: 1280,
		height: 1024,
		licence: {
			name: 'CC BY-SA 3.0',
			url: 'https://creativecommons.org/licenses/by-sa/3.0',
			author: 'Marcin Szala',
			page: 'https://commons.wikimedia.org/wiki/File:Manastir_Visoki_De%C4%8Dani_(%D0%9C%D0%B0%D0%BD%D0%B0%D1%81%D1%82%D0%B8%D1%80_%D0%92%D0%B8%D1%81%D0%BE%D0%BA%D0%B8_%D0%94%D0%B5%D1%87%D0%B0%D0%BD%D0%B8)_-_by_Pudelek..jpg'
		}
	},
	{
		work: 'Turku Cathedral',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Turku_Cathedral',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9f/Turun_tuomiokirkko.jpg/1280px-Turun_tuomiokirkko.jpg',
		file: 'turku-cathedral',
		width: 1280,
		height: 2073,
		licence: {
			name: 'CC BY-SA 3.0',
			url: 'https://creativecommons.org/licenses/by-sa/3.0',
			author: 'Markus Koljonen',
			page: 'https://commons.wikimedia.org/wiki/File:Turun_tuomiokirkko.jpg'
		}
	},
	{
		work: 'St Magnus Cathedral',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/St_Magnus_Cathedral',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d3/St_Magnus_Cathedral%2C_Kirkwall%2C_viewed_from_the_Bishop%27s_Palace.jpg/1280px-St_Magnus_Cathedral%2C_Kirkwall%2C_viewed_from_the_Bishop%27s_Palace.jpg',
		file: 'st-magnus-cathedral',
		width: 1280,
		height: 850,
		licence: {
			name: 'CC BY-SA 3.0',
			url: 'https://creativecommons.org/licenses/by-sa/3.0',
			author: 'Stevekeiretsu',
			page: 'https://commons.wikimedia.org/wiki/File:St_Magnus_Cathedral,_Kirkwall,_viewed_from_the_Bishop%27s_Palace.jpg'
		}
	},
	{
		work: 'Voroneț Monastery',
		artist: null,
		year: '1488',
		articleUrl: 'https://en.wikipedia.org/wiki/Vorone%C8%9B_Monastery',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b8/Voronet_Intrare.JPG/1280px-Voronet_Intrare.JPG',
		file: 'voronet-monastery',
		width: 1280,
		height: 851
	},
	{
		work: 'Pietà',
		artist: 'Michelangelo',
		year: '1498–1499',
		articleUrl: 'https://en.wikipedia.org/wiki/Piet%C3%A0_%28Michelangelo%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/6/65/Pieta_de_Michelangelo_-_Vaticano.jpg/1280px-Pieta_de_Michelangelo_-_Vaticano.jpg',
		file: 'pieta-michelangelo',
		width: 1280,
		height: 1341,
		licence: {
			name: 'CC BY 2.5',
			url: 'https://creativecommons.org/licenses/by/2.5',
			author: 'Stanislav Traykov',
			page: 'https://commons.wikimedia.org/wiki/File:Pieta_de_Michelangelo_-_Vaticano.jpg'
		}
	},
	{
		work: 'Gutenberg Bible',
		artist: 'Johannes Gutenberg',
		year: '1454–1455',
		articleUrl: 'https://en.wikipedia.org/wiki/Gutenberg_Bible',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b6/Gutenberg_Bible%2C_Lenox_Copy%2C_New_York_Public_Library%2C_2009._Pic_01.jpg/1280px-Gutenberg_Bible%2C_Lenox_Copy%2C_New_York_Public_Library%2C_2009._Pic_01.jpg',
		file: 'gutenberg-bible',
		width: 1280,
		height: 800,
		licence: {
			name: 'CC BY-SA 2.0',
			url: 'https://creativecommons.org/licenses/by-sa/2.0',
			author: 'Kevin Eng',
			page: 'https://commons.wikimedia.org/wiki/File:Gutenberg_Bible,_Lenox_Copy,_New_York_Public_Library,_2009._Pic_01.jpg'
		}
	},
	{
		work: 'Rossano Gospels',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Rossano_Gospels',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/2/27/RossanoGospelsFolio8vChristBeforePilate.jpg/1280px-RossanoGospelsFolio8vChristBeforePilate.jpg',
		file: 'rossano-gospels',
		width: 1280,
		height: 1551
	},
	{
		work: 'Daphni Monastery',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Daphni_Monastery',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/0/00/Kloster_Daphni_2017.jpg/1280px-Kloster_Daphni_2017.jpg',
		file: 'daphni-monastery',
		width: 1280,
		height: 960,
		licence: {
			name: 'CC BY-SA 4.0',
			url: 'https://creativecommons.org/licenses/by-sa/4.0',
			author: 'Ktiv',
			page: 'https://commons.wikimedia.org/wiki/File:Kloster_Daphni_2017.jpg'
		}
	},
	{
		work: 'Moses',
		artist: 'Michelangelo',
		year: '1513–1515',
		articleUrl: 'https://en.wikipedia.org/wiki/Moses_%28Michelangelo%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/5/59/Michelangelo%27s_Moses_%28Rome%29.jpg/1280px-Michelangelo%27s_Moses_%28Rome%29.jpg',
		file: 'moses-michelangelo',
		width: 1280,
		height: 1540,
		licence: {
			name: 'CC BY-SA 4.0',
			url: 'https://creativecommons.org/licenses/by-sa/4.0',
			author: 'Livioandronico2013',
			page: 'https://commons.wikimedia.org/wiki/File:Michelangelo%27s_Moses_(Rome).jpg'
		}
	},
	{
		work: 'Godescalc Evangelistary',
		artist: 'Godescalc',
		year: '781–783',
		articleUrl: 'https://en.wikipedia.org/wiki/Godescalc_Evangelistary',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8b/Evangeliarium_-_%C3%A9vang%C3%A9liaire_dit_de_Charlemagne_ou_de_Godescalc_-_J%C3%A9sus-Christ_-_BNF_Gallica.jpg/1280px-Evangeliarium_-_%C3%A9vang%C3%A9liaire_dit_de_Charlemagne_ou_de_Godescalc_-_J%C3%A9sus-Christ_-_BNF_Gallica.jpg',
		file: 'godescalc-evangelistary',
		width: 1280,
		height: 1894
	},
	{
		work: 'Codex Aureus of Lorsch',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Codex_Aureus_of_Lorsch',
		sourceUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/a3/Codexaureus_19.jpg',
		file: 'codex-aureus-of-lorsch',
		width: 725,
		height: 1000
	},
	{
		work: 'Ecstasy of Saint Teresa',
		artist: 'Gian Lorenzo Bernini',
		year: '1647–1652',
		articleUrl: 'https://en.wikipedia.org/wiki/Ecstasy_of_Saint_Teresa',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1a/Ecstasy_of_St._Teresa_HDR.jpg/1280px-Ecstasy_of_St._Teresa_HDR.jpg',
		file: 'ecstasy-of-saint-teresa',
		width: 1280,
		height: 2087,
		licence: {
			name: 'CC BY-SA 4.0',
			url: 'https://creativecommons.org/licenses/by-sa/4.0',
			author: 'Livioandronico2013',
			page: 'https://commons.wikimedia.org/wiki/File:Ecstasy_of_St._Teresa_HDR.jpg'
		}
	},
	{
		work: 'Mausoleum of Galla Placidia',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Mausoleum_of_Galla_Placidia',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bc/Mausoleum_of_Galla_Placidia_in_Ravenna.JPG/1280px-Mausoleum_of_Galla_Placidia_in_Ravenna.JPG',
		file: 'mausoleum-of-galla-placidia',
		width: 1280,
		height: 1040,
		licence: {
			name: 'CC BY-SA 4.0',
			url: 'https://creativecommons.org/licenses/by-sa/4.0',
			author: 'Petar Milošević',
			page: 'https://commons.wikimedia.org/wiki/File:Mausoleum_of_Galla_Placidia_in_Ravenna.JPG'
		}
	},
	{
		work: 'Scrovegni Chapel',
		artist: 'Giotto',
		year: 'c. 1305',
		articleUrl: 'https://en.wikipedia.org/wiki/Scrovegni_Chapel',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/6/61/Padova_Cappella_degli_Scrovegni_Innen_Langhaus_West_5.jpg/1280px-Padova_Cappella_degli_Scrovegni_Innen_Langhaus_West_5.jpg',
		file: 'scrovegni-chapel',
		width: 1280,
		height: 990,
		licence: {
			name: 'CC BY-SA 4.0',
			url: 'https://creativecommons.org/licenses/by-sa/4.0',
			author: 'Zairon',
			page: 'https://commons.wikimedia.org/wiki/File:Padova_Cappella_degli_Scrovegni_Innen_Langhaus_West_5.jpg'
		}
	},
	{
		work: "Basilica of Sant'Apollinare Nuovo",
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Basilica_of_Sant%27Apollinare_Nuovo',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/5/51/Ravenna%2C_sant%27apollinare_nuovo%2C_ext._01.JPG/1280px-Ravenna%2C_sant%27apollinare_nuovo%2C_ext._01.JPG',
		file: 'basilica-of-sant-apollinare-nuovo',
		width: 1280,
		height: 960,
		licence: {
			name: 'CC BY-SA 3.0',
			url: 'https://creativecommons.org/licenses/by-sa/3.0',
			author: 'Sailko',
			page: 'https://commons.wikimedia.org/wiki/File:Ravenna,_sant%27apollinare_nuovo,_ext._01.JPG'
		}
	},
	{
		work: "Basilica of Sant'Apollinare in Classe",
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Basilica_of_Sant%27Apollinare_in_Classe',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b6/Ravenna_BW_1.JPG/1280px-Ravenna_BW_1.JPG',
		file: 'basilica-of-sant-apollinare-in-classe',
		width: 1280,
		height: 853
	},
	{
		work: 'Chora Church',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/The_Chora',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/Chora_Church_2024.jpg/1280px-Chora_Church_2024.jpg',
		file: 'the-chora',
		width: 1280,
		height: 720
	},
	{
		work: 'Cappella Palatina',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Cappella_Palatina',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/2/28/Cappella_Palatina%2C_Palermo._Vista_dell%27interno_e_abside.jpg/1280px-Cappella_Palatina%2C_Palermo._Vista_dell%27interno_e_abside.jpg',
		file: 'cappella-palatina',
		width: 1280,
		height: 1052,
		licence: {
			name: 'CC BY-SA 4.0',
			url: 'https://creativecommons.org/licenses/by-sa/4.0',
			author: 'Gennadii Saus i Segura',
			page: 'https://commons.wikimedia.org/wiki/File:Cappella_Palatina,_Palermo._Vista_dell%27interno_e_abside.jpg'
		}
	},
	{
		work: 'Gero Cross',
		artist: null,
		year: 'c. 970',
		articleUrl: 'https://en.wikipedia.org/wiki/Gero_Cross',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ec/Gerokreuz_full_20050903.jpg/1280px-Gerokreuz_full_20050903.jpg',
		file: 'gero-cross',
		width: 1280,
		height: 1990,
		licence: {
			name: 'CC BY-SA 3.0',
			url: 'https://creativecommons.org/licenses/by-sa/3.0/',
			author: 'Elya',
			page: 'https://commons.wikimedia.org/wiki/File:Gerokreuz_full_20050903.jpg'
		}
	},
	{
		work: 'Hosios Loukas',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Hosios_Loukas',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bb/%CE%9C%CE%BF%CE%BD%CE%AE_%CE%9F%CF%83%CE%AF%CE%BF%CF%85_%CE%9B%CE%BF%CF%85%CE%BA%CE%AC_1290.jpg/1280px-%CE%9C%CE%BF%CE%BD%CE%AE_%CE%9F%CF%83%CE%AF%CE%BF%CF%85_%CE%9B%CE%BF%CF%85%CE%BA%CE%AC_1290.jpg',
		file: 'hosios-loukas',
		width: 1280,
		height: 853,
		licence: {
			name: 'CC BY-SA 4.0',
			url: 'https://creativecommons.org/licenses/by-sa/4.0',
			author: 'C messier',
			page: 'https://commons.wikimedia.org/wiki/File:%CE%9C%CE%BF%CE%BD%CE%AE_%CE%9F%CF%83%CE%AF%CE%BF%CF%85_%CE%9B%CE%BF%CF%85%CE%BA%CE%AC_1290.jpg'
		}
	},
	{
		work: 'Abbey of Saint Gall',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Abbey_of_Saint_Gall',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/2/21/StGallen_asv2022-10_F%C3%BCrstabtei_img1.jpg/1280px-StGallen_asv2022-10_F%C3%BCrstabtei_img1.jpg',
		file: 'abbey-of-saint-gall',
		width: 1280,
		height: 853,
		licence: {
			name: 'FAL',
			url: 'https://artlibre.org/licence/lal/en',
			author: 'A.Savin',
			page: 'https://commons.wikimedia.org/wiki/File:StGallen_asv2022-10_F%C3%BCrstabtei_img1.jpg'
		}
	},
	{
		work: 'Glendalough',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Glendalough',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/St._Kevin%27s_Kitchen%2C_Glendalough%2C_Co._Wicklow_%282023%29.jpg/1280px-St._Kevin%27s_Kitchen%2C_Glendalough%2C_Co._Wicklow_%282023%29.jpg',
		file: 'glendalough',
		width: 1280,
		height: 852,
		licence: {
			name: 'CC BY-SA 4.0',
			url: 'https://creativecommons.org/licenses/by-sa/4.0',
			author: 'Denzillacey',
			page: 'https://commons.wikimedia.org/wiki/File:St._Kevin%27s_Kitchen,_Glendalough,_Co._Wicklow_(2023).jpg'
		}
	},
	{
		work: 'Stained glass',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Stained_glass',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b8/Chartres_RosetteNord_121_DSC08241.jpg/1280px-Chartres_RosetteNord_121_DSC08241.jpg',
		file: 'stained-glass',
		width: 1280,
		height: 2145,
		licence: {
			name: 'CC BY-SA 4.0',
			url: 'https://creativecommons.org/licenses/by-sa/4.0',
			author: 'PtrQs',
			page: 'https://commons.wikimedia.org/wiki/File:Chartres_RosetteNord_121_DSC08241.jpg'
		}
	},
	{
		work: 'Vézelay Abbey',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/V%C3%A9zelay_Abbey',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/a/aa/V%C3%A9zelay_-_Basilique_Sainte-Marie-Madeleine_-_Ext%C3%A9rieur_-_10.jpg/1280px-V%C3%A9zelay_-_Basilique_Sainte-Marie-Madeleine_-_Ext%C3%A9rieur_-_10.jpg',
		file: 'vezelay-abbey',
		width: 1280,
		height: 1792,
		licence: {
			name: 'CC BY-SA 4.0',
			url: 'https://creativecommons.org/licenses/by-sa/4.0',
			author: 'Benjamin Smith',
			page: 'https://commons.wikimedia.org/wiki/File:V%C3%A9zelay_-_Basilique_Sainte-Marie-Madeleine_-_Ext%C3%A9rieur_-_10.jpg'
		}
	},
	{
		work: 'Black Madonna of Częstochowa',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Black_Madonna_of_Cz%C4%99stochowa',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/6/60/Czestochowa_MB_Czestochowska.jpg/1280px-Czestochowa_MB_Czestochowska.jpg',
		file: 'black-madonna-of-czestochowa',
		width: 1280,
		height: 1989,
		licence: {
			name: 'CC BY-SA 4.0',
			url: 'https://creativecommons.org/licenses/by-sa/4.0',
			author: 'Andrzej Otrębski',
			page: 'https://commons.wikimedia.org/wiki/File:Czestochowa_MB_Czestochowska.jpg'
		}
	},
	{
		work: 'Clonmacnoise',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Clonmacnoise',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d1/Clonmacnoise_6.jpg/1280px-Clonmacnoise_6.jpg',
		file: 'clonmacnoise',
		width: 1280,
		height: 853,
		licence: {
			name: 'CC BY-SA 3.0',
			url: 'https://creativecommons.org/licenses/by-sa/3.0',
			author: 'Ingo Mehling',
			page: 'https://commons.wikimedia.org/wiki/File:Clonmacnoise_6.jpg'
		}
	},
	{
		work: 'Our Lady of Kazan',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Our_Lady_of_Kazan',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/0/07/%D0%9C%D0%BE%D1%81%D0%BA%D0%BE%D0%B2%D1%81%D0%BA%D0%B0%D1%8F_%D0%9A%D0%B0%D0%B7%D0%B0%D0%BD%D1%81%D0%BA%D0%B0%D1%8F_%D0%B8%D0%BA%D0%BE%D0%BD%D0%B0.jpg/1280px-%D0%9C%D0%BE%D1%81%D0%BA%D0%BE%D0%B2%D1%81%D0%BA%D0%B0%D1%8F_%D0%9A%D0%B0%D0%B7%D0%B0%D0%BD%D1%81%D0%BA%D0%B0%D1%8F_%D0%B8%D0%BA%D0%BE%D0%BD%D0%B0.jpg',
		file: 'our-lady-of-kazan',
		width: 1280,
		height: 1483
	},
	{
		work: 'Autun Cathedral',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Autun_Cathedral',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7e/Cath%C3%A9drale_d%27Autun_%2871%29_-_panoramio.jpg/1280px-Cath%C3%A9drale_d%27Autun_%2871%29_-_panoramio.jpg',
		file: 'autun-cathedral',
		width: 1280,
		height: 1707,
		licence: {
			name: 'CC BY-SA 3.0',
			url: 'https://creativecommons.org/licenses/by-sa/3.0',
			author: 'Gilles Guillamot',
			page: 'https://commons.wikimedia.org/wiki/File:Cath%C3%A9drale_d%27Autun_(71)_-_panoramio.jpg'
		}
	},
	{
		work: 'Cefalù Cathedral',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Cefal%C3%B9_Cathedral',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9d/Duomo_cefalu_msu2017-0797.jpg/1280px-Duomo_cefalu_msu2017-0797.jpg',
		file: 'cefalu-cathedral',
		width: 1280,
		height: 1185,
		licence: {
			name: 'CC BY-SA 4.0',
			url: 'https://creativecommons.org/licenses/by-sa/4.0',
			author: 'Matthias Süßen',
			page: 'https://commons.wikimedia.org/wiki/File:Duomo_cefalu_msu2017-0797.jpg'
		}
	},
	{
		work: 'Cross of Lothair',
		artist: null,
		year: 'c. 1000',
		articleUrl: 'https://en.wikipedia.org/wiki/Cross_of_Lothair',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ad/Lotharkreuz-Domschatzkammer-Aachen-2026.jpg/1280px-Lotharkreuz-Domschatzkammer-Aachen-2026.jpg',
		file: 'cross-of-lothair',
		width: 1280,
		height: 2355,
		licence: {
			name: 'CC BY-SA 4.0',
			url: 'https://creativecommons.org/licenses/by-sa/4.0',
			author: 'Tuxyso',
			page: 'https://commons.wikimedia.org/wiki/File:Lotharkreuz-Domschatzkammer-Aachen-2026.jpg'
		}
	},
	{
		work: 'Moissac Abbey',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Moissac_Abbey',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ed/Moissac_4.jpg/1280px-Moissac_4.jpg',
		file: 'moissac-abbey',
		width: 1280,
		height: 960
	},
	{
		work: 'Kyiv Pechersk Lavra',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Kyiv_Pechersk_Lavra',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/f/fb/%D0%9B%D0%B0%D0%B2%D1%80%D0%B0.jpg/1280px-%D0%9B%D0%B0%D0%B2%D1%80%D0%B0.jpg',
		file: 'kyiv-pechersk-lavra',
		width: 1280,
		height: 804,
		licence: {
			name: 'CC BY-SA 3.0',
			url: 'https://creativecommons.org/licenses/by-sa/3.0',
			author: 'Falin',
			page: 'https://commons.wikimedia.org/wiki/File:%D0%9B%D0%B0%D0%B2%D1%80%D0%B0.jpg'
		}
	},
	{
		work: 'Saint Sophia Cathedral, Kyiv',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Saint_Sophia_Cathedral%2C_Kyiv',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/6/61/80-391-0151_Kyiv_St.Sophia%27s_Cathedral_RB_18_2_%28cropped%29.jpg/1280px-80-391-0151_Kyiv_St.Sophia%27s_Cathedral_RB_18_2_%28cropped%29.jpg',
		file: 'saint-sophia-cathedral-kyiv',
		width: 1280,
		height: 961,
		licence: {
			name: 'CC BY-SA 4.0',
			url: 'https://creativecommons.org/licenses/by-sa/4.0',
			author: 'Rbrechko',
			page: 'https://commons.wikimedia.org/wiki/File:80-391-0151_Kyiv_St.Sophia%27s_Cathedral_RB_18_2_(cropped).jpg'
		}
	},
	{
		work: 'Trinity Lavra of St. Sergius',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Trinity_Lavra_of_St._Sergius',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/8/8a/%D0%A1%D0%B5%D1%80%D0%B3%D0%B8%D0%B5%D0%B2_%D0%9F%D0%BE%D1%81%D0%B0%D0%B4._%D0%A2%D1%80%D0%BE%D0%B8%D1%86%D0%B5-%D0%A1%D0%B5%D1%80%D0%B3%D0%B8%D0%B5%D0%B2%D0%B0_%D0%BB%D0%B0%D0%B2%D1%80%D0%B0._1.jpg',
		file: 'trinity-lavra-of-st-sergius',
		width: 800,
		height: 594,
		licence: {
			name: 'CC BY-SA 3.0',
			url: 'https://creativecommons.org/licenses/by-sa/3.0',
			author: 'Александр Гришин',
			page: 'https://commons.wikimedia.org/wiki/File:%D0%A1%D0%B5%D1%80%D0%B3%D0%B8%D0%B5%D0%B2_%D0%9F%D0%BE%D1%81%D0%B0%D0%B4._%D0%A2%D1%80%D0%BE%D0%B8%D1%86%D0%B5-%D0%A1%D0%B5%D1%80%D0%B3%D0%B8%D0%B5%D0%B2%D0%B0_%D0%BB%D0%B0%D0%B2%D1%80%D0%B0._1.jpg'
		}
	},
	{
		work: 'Solovetsky Monastery',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Solovetsky_Monastery',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f8/%D0%A1%D0%BE%D0%BB%D0%BE%D0%B2%D0%B5%D1%86%D0%BA%D0%B8%D0%B9_%D0%BC%D0%BE%D0%BD%D0%B0%D1%81%D1%82%D1%8B%D1%80%D1%8C.jpg/1280px-%D0%A1%D0%BE%D0%BB%D0%BE%D0%B2%D0%B5%D1%86%D0%BA%D0%B8%D0%B9_%D0%BC%D0%BE%D0%BD%D0%B0%D1%81%D1%82%D1%8B%D1%80%D1%8C.jpg',
		file: 'solovetsky-monastery',
		width: 1280,
		height: 853,
		licence: {
			name: 'CC BY-SA 4.0',
			url: 'https://creativecommons.org/licenses/by-sa/4.0',
			author: 'Алексей Задонский',
			page: 'https://commons.wikimedia.org/wiki/File:%D0%A1%D0%BE%D0%BB%D0%BE%D0%B2%D0%B5%D1%86%D0%BA%D0%B8%D0%B9_%D0%BC%D0%BE%D0%BD%D0%B0%D1%81%D1%82%D1%8B%D1%80%D1%8C.jpg'
		}
	},
	{
		work: 'Ferapontov Monastery',
		artist: null,
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Ferapontov_Monastery',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0b/Ferapontovo_drone_cut.jpg/1280px-Ferapontovo_drone_cut.jpg',
		file: 'ferapontov-monastery',
		width: 1280,
		height: 1280,
		licence: {
			name: 'CC BY-SA 4.0',
			url: 'https://creativecommons.org/licenses/by-sa/4.0',
			author: 'Trasprd',
			page: 'https://commons.wikimedia.org/wiki/File:Ferapontovo_drone_cut.jpg'
		}
	},
	{
		work: 'Church of the Intercession on the Nerl',
		artist: null,
		year: '1165',
		articleUrl: 'https://en.wikipedia.org/wiki/Church_of_the_Intercession_on_the_Nerl',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/0/01/Bogolyubovo_asv2019-01_img06_Intercession_Church.jpg/1280px-Bogolyubovo_asv2019-01_img06_Intercession_Church.jpg',
		file: 'church-of-the-intercession-on-the-nerl',
		width: 1280,
		height: 1067,
		licence: {
			name: 'FAL',
			url: 'https://artlibre.org/licence/lal/en',
			author: 'A.Savin',
			page: 'https://commons.wikimedia.org/wiki/File:Bogolyubovo_asv2019-01_img06_Intercession_Church.jpg'
		}
	}
];

/**
 * The painting for an event, or null for a category this does not apply to.
 *
 * Deterministic on the id, so the same service shows the same painting on every render, on the
 * server and in the browser, today and next week. `id % length` spreads them evenly across a
 * listing; with over 200 images and a handful of church events on a page, two tiles sharing a painting
 * is rare and harmless.
 */
export function artworkFor(id: number, category: string, origin = ''): Artwork | null {
	const painting = churchImageFor(id, category);
	return painting ? resolve(painting, origin) : null;
}

/** The table row behind `artworkFor`, for the server code that needs the picture itself. */
export function churchImageFor(id: number, category: string): ChurchImage | null {
	if (category !== 'kyrkjeliv') return null;
	if (!Number.isInteger(id) || id < 0) return null;
	return ARTWORKS[id % ARTWORKS.length] ?? null;
}

/** The tile sizes, and the box the event page's picture is bounded by. */
const TILE_WIDTHS = [320, 640] as const;
const LARGE_BOX = { width: 1280, height: 1600 } as const;

/**
 * The widths served for a painting, ascending. Never wider than the source: upscaling would only
 * make a bigger file of the same picture. A large size barely above 640 is dropped as a duplicate.
 */
export function artworkWidths(painting: Pick<ChurchImage, 'width' | 'height'>): number[] {
	const { width, height } = painting;
	const scale = Math.min(1, LARGE_BOX.width / width, LARGE_BOX.height / height);
	const large = Math.round(width * scale);
	const widths = TILE_WIDTHS.map((w) => Math.min(w, width));
	if (large > (widths.at(-1) ?? 0) * 1.1) widths.push(large);
	return [...new Set(widths)];
}

/** The path of one served file. `origin` is empty on the site; the MCP view needs it absolute. */
export function artworkPath(
	painting: Pick<ChurchImage, 'file'>,
	width: number,
	origin = ''
): string {
	return `${origin}/church-art/${CHURCH_ART_VERSION}/${painting.file}-${width}`;
}

/**
 * The painting and width a served file name stands for, or null for any name that is not one.
 *
 * The cache only ever fetches what this returns, so an arbitrary path can never make the server
 * fetch an arbitrary URL — or encode a size nobody asked for.
 */
export function artworkForFileName(name: string): { painting: ChurchImage; width: number } | null {
	const match = /^([a-z0-9-]+)-(\d+)$/.exec(name);
	if (!match) return null;
	const [, file, digits] = match;
	const painting = ARTWORKS.find((p) => p.file === file);
	const width = Number(digits);
	if (!painting || !artworkWidths(painting).includes(width)) return null;
	return { painting, width };
}

function resolve(painting: ChurchImage, origin: string): Artwork {
	const { work, artist, year, articleUrl, licence } = painting;
	const widths = artworkWidths(painting);
	// The middle size as `src`: a browser that ignores srcset still gets something sensible.
	const fallback = widths[Math.min(1, widths.length - 1)] ?? 320;
	return {
		work,
		artist,
		year,
		articleUrl,
		licence,
		src: artworkPath(painting, fallback, origin),
		srcset: widths.map((w) => `${artworkPath(painting, w, origin)} ${w}w`).join(', ')
	};
}

/** Who made it and when, as one line: `Michelangelo, 1498–1499`, `1165`, or nothing. */
export function artworkMaker(art: Pick<Artwork, 'artist' | 'year'>): string | null {
	return [art.artist, art.year].filter(Boolean).join(', ') || null;
}

/** The `alt` text: what it is, and whose, where somebody is named for it. */
export function artworkAlt(art: Pick<Artwork, 'work' | 'artist'>): string {
	return art.artist ? `${art.work} av ${art.artist}` : art.work;
}

/** The short credit an attribution licence asks for where there is no room for links. */
export function artworkCredit(art: Pick<Artwork, 'licence'>): string | undefined {
	return art.licence ? `Foto: ${art.licence.author} · ${art.licence.name}` : undefined;
}

/** Every row: for the tests that check the table, and for the warmer that encodes them all. */
export const ALL_IMAGES: readonly ChurchImage[] = ARTWORKS;
