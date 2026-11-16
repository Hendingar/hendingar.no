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
 * ## Where the data came from, and why none of it is fetched at runtime
 *
 * Each entry was resolved once through the Wikipedia and Wikimedia Commons APIs — the article for
 * the "learn more" link, and `imageinfo` for the rendition URLs, the artist, the date and the
 * licence. Every entry below came back `Public domain` or `CC0`; anything under a restrictive
 * licence was dropped rather than attributed around, and every URL was fetched once to confirm it
 * answers 200 with an image.
 *
 * Nothing calls an API to render a card. A live lookup would make a listing depend on somebody
 * else's uptime and would pick a different painting for the same event on two different days;
 * `artworkFor` is pure and keyed on the event id, so a service keeps its painting forever.
 *
 * ## Served from our own origin, never hotlinked
 *
 * The first version hotlinked `upload.wikimedia.org`, and on phones the paintings showed as broken
 * images. Wikimedia rate-limits its media servers per client: twenty requests at once from one
 * address came back with 74 of 80 answered `429 Too Many Requests`. A listing asks for a dozen
 * paintings in one go, and a phone on a carrier network shares its address with many other phones,
 * so the limit was easy to reach on a phone and rarely on a desktop with a warm cache.
 *
 * So each painting was fetched once, from the Commons rendition in `sourceUrl`, and resized into
 * `app/static/church-art/<file>-<width>.webp`: 320 and 640 wide for the tiles, plus one bounded at
 * 1280 on its long edge for the event page. That page caps the image height, so a 1280-wide
 * portrait would be 2000px of pixels nobody sees. `widths` lists the files that exist, and each
 * `srcset` descriptor is the width of the actual file.
 *
 * To add a painting: put the file through the same resize, and add a row whose `widths` match the
 * files. The spec checks that every listed file is on disk.
 */

/** One row of the table: what it is, where it came from, and which files we hold of it. */
type Painting = {
	/** The work, as its article names it. English: it is a title, not prose. */
	work: string;
	artist: string;
	/** A single year, or a range where the work took several. Null where none is known. */
	year: string | null;
	/** Where to read about it. The whole point of showing it. */
	articleUrl: string;
	/** The Commons rendition our files were made from. Provenance, never requested at runtime. */
	sourceUrl: string;
	/** The stem of the files in `app/static/church-art/`. */
	file: string;
	/** The widths held on disk, ascending: `<file>-<width>.webp` exists for each. */
	widths: readonly number[];
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
		widths: [320, 640, 1280]
	},
	{
		work: 'Adoration of the Shepherds',
		artist: 'El Greco',
		year: '1612–1614',
		articleUrl: 'https://en.wikipedia.org/wiki/Adoration_of_the_Shepherds_%28El_Greco%2C_Madrid%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/6/63/The_Adoration_of_the_Shepherds%2C_El_Greco.jpg/1280px-The_Adoration_of_the_Shepherds%2C_El_Greco.jpg',
		file: 'adoration-of-the-shepherds-el-greco-madrid',
		widths: [320, 640, 718]
	},
	{
		work: 'Agony in the Garden',
		artist: 'Andrea Mantegna',
		year: '1455–1456',
		articleUrl: 'https://en.wikipedia.org/wiki/Agony_in_the_Garden_%28Mantegna%2C_London%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a3/Mantegna%2C_Andrea_-_Agony_in_the_Garden_-_National_Gallery%2C_London.jpg/1280px-Mantegna%2C_Andrea_-_Agony_in_the_Garden_-_National_Gallery%2C_London.jpg',
		file: 'agony-in-the-garden-mantegna-london',
		widths: [320, 640, 1280]
	},
	{
		work: 'Annunciation',
		artist: 'Jan van Eyck',
		year: '1433–1435',
		articleUrl: 'https://en.wikipedia.org/wiki/Annunciation_%28van_Eyck%2C_Madrid%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/3/34/Jan_van_Eyck%2C_Around_1390-1441_-_The_Annuciation_Diptych_-_Google_Art_Project.jpg/1280px-Jan_van_Eyck%2C_Around_1390-1441_-_The_Annuciation_Diptych_-_Google_Art_Project.jpg',
		file: 'annunciation-van-eyck-madrid',
		widths: [320, 640, 1280]
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
		widths: [320, 640, 900]
	},
	{
		work: 'Christ Pantocrator',
		artist: 'Unknown icon painter',
		year: null,
		articleUrl: 'https://en.wikipedia.org/wiki/Christ_Pantocrator_%28Sinai%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4a/Spas_vsederzhitel_sinay.jpg/1280px-Spas_vsederzhitel_sinay.jpg',
		file: 'christ-pantocrator-sinai',
		widths: [320, 640, 686]
	},
	{
		work: 'Ghent Altarpiece',
		artist: 'Hubert and Jan van Eyck',
		year: '1432',
		articleUrl: 'https://en.wikipedia.org/wiki/Ghent_Altarpiece',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/5/50/Ghent_Altarpiece_Google_Art_Project.jpg/1280px-Ghent_Altarpiece_Google_Art_Project.jpg',
		file: 'ghent-altarpiece',
		widths: [320, 640, 1280]
	},
	{
		work: 'Isenheim Altarpiece',
		artist: 'Matthias Grünewald / Nikolaus Hagenauer',
		year: '1512–1516',
		articleUrl: 'https://en.wikipedia.org/wiki/Isenheim_Altarpiece',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e2/Isenheim_Altarpiece_-_In_situ_%28cropped%29.jpg/1280px-Isenheim_Altarpiece_-_In_situ_%28cropped%29.jpg',
		file: 'isenheim-altarpiece',
		widths: [320, 640, 1280]
	},
	{
		work: 'Jacob wrestling with the angel',
		artist: 'Gustave Doré',
		year: '1855',
		articleUrl: 'https://en.wikipedia.org/wiki/Jacob_wrestling_with_the_angel',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/4/45/Jacob_Wrestling_with_the_Angel.jpg',
		file: 'jacob-wrestling-with-the-angel',
		widths: [320, 640, 795]
	},
	{
		work: 'Lamentation of Christ',
		artist: 'Andrea Mantegna',
		year: '1470–1474',
		articleUrl: 'https://en.wikipedia.org/wiki/Lamentation_of_Christ_%28Mantegna%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f4/The_dead_Christ_and_three_mourners%2C_by_Andrea_Mantegna.jpg/1280px-The_dead_Christ_and_three_mourners%2C_by_Andrea_Mantegna.jpg',
		file: 'lamentation-of-christ-mantegna',
		widths: [320, 640, 1280]
	},
	{
		work: 'Madonna and Child',
		artist: 'Duccio di Buoninsegna',
		year: '1300',
		articleUrl: 'https://en.wikipedia.org/wiki/Madonna_and_Child_%28Duccio%2C_Metropolitan%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/6/65/Duccio_Di_Buoninsegna_-_Madonna_col_Bambino.jpg/1280px-Duccio_Di_Buoninsegna_-_Madonna_col_Bambino.jpg',
		file: 'madonna-and-child-duccio-metropolitan',
		widths: [320, 640, 965]
	},
	{
		work: 'Madonna del Prato',
		artist: 'Raphael',
		year: '1505–1506',
		articleUrl: 'https://en.wikipedia.org/wiki/Madonna_del_Prato_%28Raphael%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Raphael_-_Madonna_in_the_Meadow_-_Google_Art_Project.jpg/1280px-Raphael_-_Madonna_in_the_Meadow_-_Google_Art_Project.jpg',
		file: 'madonna-del-prato-raphael',
		widths: [320, 640, 1000]
	},
	{
		work: 'Madonna of the Rosary',
		artist: 'Caravaggio',
		year: '1605–1607',
		articleUrl: 'https://en.wikipedia.org/wiki/Madonna_of_the_Rosary_%28Caravaggio%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1f/Michelangelo_Merisi%2C_called_Caravaggio_-_Madonna_of_the_Rosary_-_Google_Art_Project.jpg/1280px-Michelangelo_Merisi%2C_called_Caravaggio_-_Madonna_of_the_Rosary_-_Google_Art_Project.jpg',
		file: 'madonna-of-the-rosary-caravaggio',
		widths: [320, 640, 881]
	},
	{
		work: 'Mond Crucifixion',
		artist: 'Raphael',
		year: '1502–1503',
		articleUrl: 'https://en.wikipedia.org/wiki/Mond_Crucifixion',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/1/18/CrocefissioneRaffaello.jpg/1280px-CrocefissioneRaffaello.jpg',
		file: 'mond-crucifixion',
		widths: [320, 640, 766]
	},
	{
		work: 'Noli me tangere',
		artist: 'Titian',
		year: '1514',
		articleUrl: 'https://en.wikipedia.org/wiki/Noli_me_tangere_%28Titian%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/9/93/Noli-me-tangere-titien.jpg/1280px-Noli-me-tangere-titien.jpg',
		file: 'noli-me-tangere-titian',
		widths: [320, 640, 1067]
	},
	{
		work: 'Opening of the Fifth Seal',
		artist: 'El Greco',
		year: '1609–1614',
		articleUrl: 'https://en.wikipedia.org/wiki/Opening_of_the_Fifth_Seal',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b4/The_Vision_of_Saint_John_MET_DT1052.jpg/1280px-The_Vision_of_Saint_John_MET_DT1052.jpg',
		file: 'opening-of-the-fifth-seal',
		widths: [320, 640, 1128]
	},
	{
		work: 'Rest on the Flight into Egypt',
		artist: 'Caravaggio',
		year: '1597',
		articleUrl: 'https://en.wikipedia.org/wiki/Rest_on_the_Flight_into_Egypt_%28Caravaggio%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/7/73/Rest_on_the_Flight_into_Egypt-Caravaggio_%28c.1597%29.jpg/1280px-Rest_on_the_Flight_into_Egypt-Caravaggio_%28c.1597%29.jpg',
		file: 'rest-on-the-flight-into-egypt-caravaggio',
		widths: [320, 640, 1280]
	},
	{
		work: 'Saint Francis in Ecstasy',
		artist: 'Giovanni Bellini',
		year: '1480',
		articleUrl: 'https://en.wikipedia.org/wiki/Saint_Francis_in_Ecstasy_%28Bellini%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d7/Giovanni_Bellini_-_Saint_Francis_in_the_Desert_-_Google_Art_Project.jpg/1280px-Giovanni_Bellini_-_Saint_Francis_in_the_Desert_-_Google_Art_Project.jpg',
		file: 'saint-francis-in-ecstasy-bellini',
		widths: [320, 640, 1280]
	},
	{
		work: 'Saint Jerome Writing',
		artist: 'Caravaggio',
		year: '1605–1606',
		articleUrl: 'https://en.wikipedia.org/wiki/Saint_Jerome_Writing',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4d/Saint_Jerome_Writing-Caravaggio_%281605-6%29.jpg/1280px-Saint_Jerome_Writing-Caravaggio_%281605-6%29.jpg',
		file: 'saint-jerome-writing',
		widths: [320, 640, 1280]
	},
	{
		work: 'Sistine Madonna',
		artist: 'Raphael',
		year: '1512–1527',
		articleUrl: 'https://en.wikipedia.org/wiki/Sistine_Madonna',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7a/RAFAEL_-_Madonna_Sixtina_%28Gem%C3%A4ldegalerie_Alter_Meister%2C_Dresden%2C_1513-14._%C3%93leo_sobre_lienzo%2C_265_x_196_cm%29.jpg/1280px-RAFAEL_-_Madonna_Sixtina_%28Gem%C3%A4ldegalerie_Alter_Meister%2C_Dresden%2C_1513-14._%C3%93leo_sobre_lienzo%2C_265_x_196_cm%29.jpg',
		file: 'sistine-madonna',
		widths: [320, 640, 934]
	},
	{
		work: 'Supper at Emmaus',
		artist: 'Caravaggio',
		year: '1601',
		articleUrl: 'https://en.wikipedia.org/wiki/Supper_at_Emmaus_%28Caravaggio%2C_London%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4d/1602-3_Caravaggio%2CSupper_at_Emmaus_National_Gallery%2C_London.jpg/1280px-1602-3_Caravaggio%2CSupper_at_Emmaus_National_Gallery%2C_London.jpg',
		file: 'supper-at-emmaus-caravaggio-london',
		widths: [320, 640, 1280]
	},
	{
		work: 'The Angelus',
		artist: 'Jean-François Millet',
		year: '1857–1859',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Angelus_%28painting%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/1/17/JEAN-FRAN%C3%87OIS_MILLET_-_El_%C3%81ngelus_%28Museo_de_Orsay%2C_1857-1859._%C3%93leo_sobre_lienzo%2C_55.5_x_66_cm%29.jpg/1280px-JEAN-FRAN%C3%87OIS_MILLET_-_El_%C3%81ngelus_%28Museo_de_Orsay%2C_1857-1859._%C3%93leo_sobre_lienzo%2C_55.5_x_66_cm%29.jpg',
		file: 'the-angelus-painting',
		widths: [320, 640, 1280]
	},
	{
		work: 'The Baptism of Christ',
		artist: 'Piero della Francesca',
		year: '1448–1450',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Baptism_of_Christ_%28Piero_della_Francesca%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Piero_della_Francesca_-_Baptism_of_Christ_-_WGA17595.jpg/1280px-Piero_della_Francesca_-_Baptism_of_Christ_-_WGA17595.jpg',
		file: 'the-baptism-of-christ-piero-della-francesca',
		widths: [320, 640, 876]
	},
	{
		work: 'The Calling of Saint Matthew',
		artist: 'Caravaggio',
		year: '1599–1600',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Calling_of_Saint_Matthew',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/5/59/Caravaggio_%E2%80%94_The_Calling_of_Saint_Matthew.jpg/1280px-Caravaggio_%E2%80%94_The_Calling_of_Saint_Matthew.jpg',
		file: 'the-calling-of-saint-matthew',
		widths: [320, 640, 1280]
	},
	{
		work: 'The Conversion of Saint Paul',
		artist: 'Caravaggio',
		year: '1600',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Conversion_of_Saint_Paul_%28Caravaggio%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bb/The_Conversion_of_Saint_Paul-Caravaggio_%28c._1600-1%29.jpg/1280px-The_Conversion_of_Saint_Paul-Caravaggio_%28c._1600-1%29.jpg',
		file: 'the-conversion-of-saint-paul-caravaggio',
		widths: [320, 640, 1025]
	},
	{
		work: 'The Creation of Adam',
		artist: 'Michelangelo',
		year: '1511',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Creation_of_Adam',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5b/Michelangelo_-_Creation_of_Adam_%28cropped%29.jpg/1280px-Michelangelo_-_Creation_of_Adam_%28cropped%29.jpg',
		file: 'the-creation-of-adam',
		widths: [320, 640, 1280]
	},
	{
		work: 'The Deposition from the Cross',
		artist: 'Pontormo',
		year: '1525–1528',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Deposition_from_the_Cross_%28Pontormo%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/5/58/Jacopo_Pontormo_-_Kreuzabnahme_Christi.jpg/1280px-Jacopo_Pontormo_-_Kreuzabnahme_Christi.jpg',
		file: 'the-deposition-from-the-cross-pontormo',
		widths: [320, 640, 798]
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
		widths: [320, 640, 941]
	},
	{
		work: 'The Elevation of the Cross',
		artist: 'Peter Paul Rubens',
		year: '1610–1611',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Elevation_of_the_Cross_%28Rubens%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/c/ca/Peter_Paul_Rubens_-_Raising_of_the_Cross_%28Antwerp_Cathedral%29.JPG/1280px-Peter_Paul_Rubens_-_Raising_of_the_Cross_%28Antwerp_Cathedral%29.JPG',
		file: 'the-elevation-of-the-cross-rubens',
		widths: [320, 640, 1280]
	},
	{
		work: 'The Entombment of Christ',
		artist: 'Caravaggio',
		year: '1603–1604',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Entombment_of_Christ_%28Caravaggio%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/3/34/The_Entombment_of_Christ-Caravaggio_%28c.1602-3%29.jpg/1280px-The_Entombment_of_Christ-Caravaggio_%28c.1602-3%29.jpg',
		file: 'the-entombment-of-christ-caravaggio',
		widths: [320, 640, 862]
	},
	{
		work: 'The Garden of Earthly Delights',
		artist: 'Hieronymus Bosch',
		year: '1480–1505',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Garden_of_Earthly_Delights',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/9/96/The_Garden_of_earthly_delights.jpg/1280px-The_Garden_of_earthly_delights.jpg',
		file: 'the-garden-of-earthly-delights',
		widths: [320, 640, 1280]
	},
	{
		work: 'The Incredulity of Saint Thomas',
		artist: 'Caravaggio',
		year: '1601–1602',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Incredulity_of_Saint_Thomas_%28Caravaggio%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6c/Der_ungl%C3%A4ubige_Thomas_-_Michelangelo_Merisi%2C_named_Caravaggio.jpg/1280px-Der_ungl%C3%A4ubige_Thomas_-_Michelangelo_Merisi%2C_named_Caravaggio.jpg',
		file: 'the-incredulity-of-saint-thomas-caravaggio',
		widths: [320, 640, 1280]
	},
	{
		work: 'The Last Supper',
		artist: 'Leonardo da Vinci',
		year: '1495–1498',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Last_Supper_%28Leonardo%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/4/48/The_Last_Supper_-_Leonardo_Da_Vinci_-_High_Resolution_32x16.jpg/1280px-The_Last_Supper_-_Leonardo_Da_Vinci_-_High_Resolution_32x16.jpg',
		file: 'the-last-supper-leonardo',
		widths: [320, 640, 1280]
	},
	{
		work: 'The Light of the World',
		artist: 'William Holman Hunt',
		year: '1851–1852',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Light_of_the_World_%28Hunt%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bc/Hunt-light-of-the-world.jpeg/1280px-Hunt-light-of-the-world.jpeg',
		file: 'the-light-of-the-world-hunt',
		widths: [320, 640, 645]
	},
	{
		work: 'The Parable of the Blind',
		artist: 'Pieter Brueghel the Elder',
		year: '1568',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Parable_of_the_Blind',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c1/%D0%9F%D1%80%D0%B8%D1%82%D1%87%D0%B0_%D0%BE_%D1%81%D0%BB%D0%B5%D0%BF%D1%8B%D1%85.jpeg/1280px-%D0%9F%D1%80%D0%B8%D1%82%D1%87%D0%B0_%D0%BE_%D1%81%D0%BB%D0%B5%D0%BF%D1%8B%D1%85.jpeg',
		file: 'the-parable-of-the-blind',
		widths: [320, 640, 1280]
	},
	{
		work: 'The Return of the Prodigal Son',
		artist: 'Rembrandt',
		year: '1668',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Return_of_the_Prodigal_Son_%28Rembrandt%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/9/93/Rembrandt_Harmensz_van_Rijn_-_Return_of_the_Prodigal_Son_-_Google_Art_Project.jpg/1280px-Rembrandt_Harmensz_van_Rijn_-_Return_of_the_Prodigal_Son_-_Google_Art_Project.jpg',
		file: 'the-return-of-the-prodigal-son-rembrandt',
		widths: [320, 640, 981]
	},
	{
		work: 'The Storm on the Sea of Galilee',
		artist: 'Rembrandt',
		year: '1633',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Storm_on_the_Sea_of_Galilee',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f3/Rembrandt_Christ_in_the_Storm_on_the_Lake_of_Galilee.jpg/1280px-Rembrandt_Christ_in_the_Storm_on_the_Lake_of_Galilee.jpg',
		file: 'the-storm-on-the-sea-of-galilee',
		widths: [320, 640, 1030]
	},
	{
		work: 'The Tribute Money',
		artist: 'Masaccio',
		year: '1424–1428',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Tribute_Money_%28Masaccio%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b3/The_Tribute_Money_by_Masaccio.jpg/1280px-The_Tribute_Money_by_Masaccio.jpg',
		file: 'the-tribute-money-masaccio',
		widths: [320, 640, 1280]
	},
	{
		work: 'The Wedding at Cana',
		artist: 'Paolo Veronese',
		year: '1563',
		articleUrl: 'https://en.wikipedia.org/wiki/The_Wedding_at_Cana_%28Veronese%29',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/Paolo_Veronese_008.jpg/1280px-Paolo_Veronese_008.jpg',
		file: 'the-wedding-at-cana-veronese',
		widths: [320, 640, 1280]
	},
	{
		work: 'Transfiguration',
		artist: 'Raphael',
		year: '1516–1520',
		articleUrl: 'https://en.wikipedia.org/wiki/Transfiguration_%28Raphael%29',
		sourceUrl: 'https://upload.wikimedia.org/wikipedia/commons/5/51/Transfiguration_Raphael.jpg',
		file: 'transfiguration-raphael',
		widths: [320, 640, 849]
	},
	{
		work: 'Virgin of the Rocks',
		artist: 'Leonardo da Vinci',
		year: '1483–1486',
		articleUrl: 'https://en.wikipedia.org/wiki/Virgin_of_the_Rocks',
		sourceUrl:
			'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e4/Leonardo_Da_Vinci_-_Vergine_delle_Rocce_%28Louvre%29.jpg/1280px-Leonardo_Da_Vinci_-_Vergine_delle_Rocce_%28Louvre%29.jpg',
		file: 'virgin-of-the-rocks',
		widths: [320, 640, 807]
	}
];

/**
 * The painting for an event, or null for a category this does not apply to.
 *
 * Deterministic on the id, so the same service shows the same painting on every render, on the
 * server and in the browser, today and next week. `id % length` spreads them evenly across a
 * listing; with 41 works and a handful of church events on a page, two tiles sharing a painting is
 * rare and harmless.
 */
export function artworkFor(id: number, category: string, origin = ''): Artwork | null {
	if (category !== 'kyrkjeliv') return null;
	if (!Number.isInteger(id) || id < 0) return null;
	const painting = ARTWORKS[id % ARTWORKS.length];
	return painting ? resolve(painting, origin) : null;
}

/** The path of one held file. `origin` is empty on the site; the MCP view needs it absolute. */
export function artworkFile(painting: Pick<Painting, 'file'>, width: number, origin = ''): string {
	return `${origin}/church-art/${painting.file}-${width}.webp`;
}

function resolve(painting: Painting, origin: string): Artwork {
	const { work, artist, year, articleUrl, widths } = painting;
	// The middle rendition as `src`: a browser without srcset support still gets a sensible size.
	const fallback = widths[Math.min(1, widths.length - 1)] ?? 320;
	return {
		work,
		artist,
		year,
		articleUrl,
		src: artworkFile(painting, fallback, origin),
		srcset: widths.map((w) => `${artworkFile(painting, w, origin)} ${w}w`).join(', ')
	};
}

/** Only for the tests that check the table itself. */
export const ALL_PAINTINGS: readonly Painting[] = ARTWORKS;
