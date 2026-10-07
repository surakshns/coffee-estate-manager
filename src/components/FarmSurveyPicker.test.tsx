// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FarmSurveyPicker } from './FarmSurveyPicker'
import type { SurveyParcel } from '../lib/farmSurveyMap'
const api=vi.hoisted(()=>({load:vi.fn()}))
vi.mock('../lib/farmSurveyMap',async importOriginal=>({...await importOriginal<typeof import('../lib/farmSurveyMap')>(),loadSurveyParcels:api.load}))
const parcel:SurveyParcel={key:'12::',survey:'12',surnoc:null,hissa:null,polygons:[[[[75,13],[75.01,13],[75.01,13.01],[75,13.01],[75,13]]]]}
const result=(parcels=[parcel])=>({parcels,sourceUrl:'https://kgis.ksrsac.in/kgismaps2/rest/services/test/query',retrievedAt:'2026-10-07T00:00:00Z'})
beforeEach(()=>{
 vi.clearAllMocks()
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(){this.setAttribute('open','')}})
 Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(){this.removeAttribute('open')}})
 api.load.mockImplementation(async(_v,_s,survey)=>result(survey?[]:[parcel]))
})
afterEach(()=>cleanup())
describe('survey selection workflow',()=>{
 it('loads only on explicit village choice and applies a confirmed interior map point',async()=>{
  const user=userEvent.setup(),select=vi.fn();render(<FarmSurveyPicker onSelect={select}/>)
  expect(api.load).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button',{name:'Select survey number on map'}))
  expect(api.load).not.toHaveBeenCalled()
  await user.selectOptions(screen.getByLabelText('Map village'),'hebbasale')
  await waitFor(()=>expect(screen.getByRole('option',{name:'12'})).toBeTruthy())
  await user.selectOptions(screen.getByLabelText('Survey number'),'12::')
  const use=await screen.findByRole('button',{name:'Use this survey location'})
  await waitFor(()=>expect(use.hasAttribute('disabled')).toBe(false))
  expect(select).not.toHaveBeenCalled()
  await user.click(use)
  expect(select).toHaveBeenCalledWith(expect.objectContaining({village:expect.objectContaining({id:'hebbasale'}),latitude:expect.any(Number),longitude:expect.any(Number),level:'whole_survey'}))
  expect(screen.queryByRole('dialog')).toBeNull()
 })
 it('chooses a numbered subdivision independently from the whole survey',async()=>{
  api.load.mockImplementation(async(_v,_s,survey)=>result(survey?[{...parcel,key:'12:*:1',hissa:'1',surnoc:'*'}]:[parcel]))
  const user=userEvent.setup(),select=vi.fn();render(<FarmSurveyPicker onSelect={select}/>)
  await user.click(screen.getByRole('button',{name:'Select survey number on map'}));await user.selectOptions(screen.getByLabelText('Map village'),'devihalli')
  await screen.findByRole('option',{name:'12'});await user.selectOptions(screen.getByLabelText('Survey number'),'12::')
  await screen.findByRole('option',{name:'12 / 1'});await user.selectOptions(screen.getByLabelText('Subdivision / Hissa'),'12:*:1')
  await user.click(screen.getByRole('button',{name:'Use this subdivision location'}))
  expect(select.mock.calls[0][0]).toMatchObject({level:'hissa',parcel:{hissa:'1',surnoc:'*'}})
 })
 it('ignores a previous village response after switching villages',async()=>{
  let finish:(value:ReturnType<typeof result>)=>void=()=>{}
  api.load.mockImplementation(village=>village.id==='hebbasale'?new Promise(resolve=>{finish=resolve}):Promise.resolve(result([{...parcel,key:'99::',survey:'99'}])))
  const user=userEvent.setup();render(<FarmSurveyPicker onSelect={vi.fn()}/>)
  await user.click(screen.getByRole('button',{name:'Select survey number on map'}));await user.selectOptions(screen.getByLabelText('Map village'),'hebbasale');await user.selectOptions(screen.getByLabelText('Map village'),'devihalli')
  await screen.findByRole('option',{name:'99'})
  await act(async()=>finish(result()))
  expect(screen.queryByRole('option',{name:'12'})).toBeNull()
  expect(screen.getByRole('option',{name:'99'})).toBeTruthy()
 })
})
