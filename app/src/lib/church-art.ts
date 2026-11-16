/**
 * Public-domain Christian art, for the church events that have no picture of their own.
 *
 * A gudsteneste in Bremnes kyrkje arrives from a parish calendar with a title, a time and nothing
 * else — so `/hendingar` filled with identical generated tiles wherever the kyrkja importers
 * reached. This gives each of those rows a painting instead, and the painting is not decoration:
 * it is named, attributed, dated, and links to its Wikipedia article, so a tile that used to say
 * nothing now says "this is Rembrandt's Return of the Prodigal Son, and here is where to read
 * about it".
 *
 * ## It is not a claim about the event
 *
 * The painting has nothing to do with the particular service, and the caption never pretends
 * otherwise — it names the artwork, not the event. That is the honest version of what this is: a
 * piece of art beside a church notice, chosen by nothing more than the event's id.
 *
 * ## Where the data came from
 *
 * Each entry was resolved once through the Wikipedia and Commons APIs: the article's lead image,
 * its licence, and a rendition 1280 pixels wide (`sourceUrl`, with that file's own `width` and
 * `height`). Only `Public domain` and `CC0` were kept; anything under a licence that needs
 * attribution was dropped rather than attributed around. The artist and the year are written by
 * hand, because Commons metadata credits whoever photographed the painting as often as the
 * painter.
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
export type Painting = {
	/** The work, as its article names it. English: it is a title, not prose. */
	work: string;
	artist: string;
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
};

/** A painting, resolved to the addresses an `<img>` needs. */
export type Artwork = Pick<Painting, 'work' | 'artist' | 'year' | 'articleUrl'> & {
	src: string;
	srcset: string;
};

const ARTWORKS: readonly Painting[] = [
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
	}
];

/**
 * The painting for an event, or null for a category this does not apply to.
 *
 * Deterministic on the id, so the same service shows the same painting on every render, on the
 * server and in the browser, today and next week. `id % length` spreads them evenly across a
 * listing; with 99 works and a handful of church events on a page, two tiles sharing a painting
 * is rare and harmless.
 */
export function artworkFor(id: number, category: string, origin = ''): Artwork | null {
	if (category !== 'kyrkjeliv') return null;
	if (!Number.isInteger(id) || id < 0) return null;
	const painting = ARTWORKS[id % ARTWORKS.length];
	return painting ? resolve(painting, origin) : null;
}

/** The tile sizes, and the box the event page's picture is bounded by. */
const TILE_WIDTHS = [320, 640] as const;
const LARGE_BOX = { width: 1280, height: 1600 } as const;

/**
 * The widths served for a painting, ascending. Never wider than the source: upscaling would only
 * make a bigger file of the same picture. A large size barely above 640 is dropped as a duplicate.
 */
export function artworkWidths(painting: Pick<Painting, 'width' | 'height'>): number[] {
	const { width, height } = painting;
	const scale = Math.min(1, LARGE_BOX.width / width, LARGE_BOX.height / height);
	const large = Math.round(width * scale);
	const widths = TILE_WIDTHS.map((w) => Math.min(w, width));
	if (large > (widths.at(-1) ?? 0) * 1.1) widths.push(large);
	return [...new Set(widths)];
}

/** The path of one served file. `origin` is empty on the site; the MCP view needs it absolute. */
export function artworkPath(painting: Pick<Painting, 'file'>, width: number, origin = ''): string {
	return `${origin}/church-art/${CHURCH_ART_VERSION}/${painting.file}-${width}`;
}

/**
 * The painting and width a served file name stands for, or null for any name that is not one.
 *
 * The cache only ever fetches what this returns, so an arbitrary path can never make the server
 * fetch an arbitrary URL — or encode a size nobody asked for.
 */
export function artworkForFileName(name: string): { painting: Painting; width: number } | null {
	const match = /^([a-z0-9-]+)-(\d+)$/.exec(name);
	if (!match) return null;
	const [, file, digits] = match;
	const painting = ARTWORKS.find((p) => p.file === file);
	const width = Number(digits);
	if (!painting || !artworkWidths(painting).includes(width)) return null;
	return { painting, width };
}

function resolve(painting: Painting, origin: string): Artwork {
	const { work, artist, year, articleUrl } = painting;
	const widths = artworkWidths(painting);
	// The middle size as `src`: a browser that ignores srcset still gets something sensible.
	const fallback = widths[Math.min(1, widths.length - 1)] ?? 320;
	return {
		work,
		artist,
		year,
		articleUrl,
		src: artworkPath(painting, fallback, origin),
		srcset: widths.map((w) => `${artworkPath(painting, w, origin)} ${w}w`).join(', ')
	};
}

/** Only for the tests that check the table itself. */
export const ALL_PAINTINGS: readonly Painting[] = ARTWORKS;
