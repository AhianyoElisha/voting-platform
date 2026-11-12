import { describe, expect, it } from 'vitest'
import { familyKey, parsePostScriptName, spacedFamily } from '../flyer/font-names'

describe('parsePostScriptName', () => {
  it.each([
    ['Montserrat-Bold', 'Montserrat', 700, false],
    ['PlayfairDisplay-BlackItalic', 'PlayfairDisplay', 900, true],
    ['Poppins-ExtraBold', 'Poppins', 800, false],
    ['Poppins-SemiBoldItalic', 'Poppins', 600, true],
    ['OpenSans-Italic', 'OpenSans', 400, true],
    ['Lato-Regular', 'Lato', 400, false],
    ['Raleway-ExtraLight', 'Raleway', 200, false],
    ['RobotoCondensed-Bold', 'RobotoCondensed', 700, false],
    ['Roboto-CondensedBold', 'RobotoCondensed', 700, false],
    ['ArialMT', 'ArialMT', 400, false],
    ['Arial-BoldMT', 'ArialMT', 700, false],
    ['BebasNeue', 'BebasNeue', 400, false],
  ])('%s', (name, base, weight, italic) => {
    expect(parsePostScriptName(name)).toEqual({ postScriptName: name, base, weight, italic })
  })
})

describe('family helpers', () => {
  it('compares families ignoring case, spaces and punctuation', () => {
    expect(familyKey('Playfair Display')).toBe(familyKey('PlayfairDisplay'))
    expect(familyKey('Roboto Condensed')).toBe('robotocondensed')
  })

  it('spaces a camel-case family', () => {
    expect(spacedFamily('PlayfairDisplay')).toBe('Playfair Display')
    expect(spacedFamily('IBMPlexSans')).toBe('IBM Plex Sans')
    expect(spacedFamily('Montserrat')).toBe('Montserrat')
  })
})
