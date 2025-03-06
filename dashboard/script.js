import { validateConfiguration } from '../validator.js'
import { HOSTNAME, ACCOUNT, ENTU_ENTITY_URL, ENTU_FRONTEND_URL, SCREENWERK_PUBLISHER_API } from './constants.js'
import { fetchJSON } from './utils.js'
import { EntuScreenWerkPlayer } from '../sw-player.js'

// Disclaimer: no semicolons, if unnecessary, are used in this project

const toolbarSnippet = (id, publishedAt = '', screenId = '') => {
    return `
        <div class="toolbar">
            <span class="published-timestamp" title="${publishedAt}">${publishedAt ? new Date(publishedAt).toLocaleString() : ''}</span>
            ${screenId ? `<a href="/?screen_id=${screenId}" target="_blank">
                <img src="/images/monitor.png" class="screen-link-icon" alt="Screen Link">
            </a>` : ''}
            <a href="${ENTU_FRONTEND_URL}/${id}" target="_blank">
                <img src="/images/entulogo.png" class="entu-logo" alt="Entu">
            </a>
        </div>
    `
}

async function fetchFromPublisher(id) {
  return await fetchJSON(`${SCREENWERK_PUBLISHER_API}${id}.json`)
}

// Fetch schedules, layouts, playlists, and media for a configuration from Entu
async function fillConfiguration(configuration_eid) {
    // if (configuration_eid !== '52d62fa84ecca5c17a5988e2') {
    //     return false
    // }
    const url = `${ENTU_ENTITY_URL}/${configuration_eid}`
    const configuration_entity = await fetchJSON(url)
    if (!configuration_entity) {
        throw new Error(`Failed to fetch configuration: ${configuration_eid}`)
    }
    // console.log("Configuration entity:", configuration_entity)
    const configuration = configuration_entity.entity
    // Harvest schedules referencing the configuration
    const schedule_props = '' // '&props=layout.reference,crontab.string'
    const schedule_entities = await fetchJSON(`${ENTU_ENTITY_URL}?_type.string=sw_schedule&_parent.reference=${configuration_eid}${schedule_props}`)
    if (!schedule_entities) {
        console.error(`Failed to fetch schedules for configuration: ${configuration_eid}`)
        return false
    }
    configuration.schedules = schedule_entities.entities
    if (configuration.schedules.length === 0) {
        console.debug(`No schedules found for configuration: ${configuration_eid}`)
        return false
    }
    // Fetch the layout in every schedule
    for (let schedule of configuration.schedules) {
        const layout_eid = schedule.layout[0].reference
        let layout_entity = await fetchJSON(`${ENTU_ENTITY_URL}/${layout_eid}`)
        if (!layout_entity) {
            console.warn(`Failed to fetch layout: ${layout_eid}`)
            continue
        }
        schedule.layout = layout_entity.entity
        // console.debug("Layout:", schedule.layout)
        // Harvest layout-playlists referencing the layout
        const layout_playlist_props = '' // '&props=playlist.reference'
        let layout_playlists_entities = await fetchJSON(`${ENTU_ENTITY_URL}?_type.string=sw_layout_playlist&_parent.reference=${layout_eid}${layout_playlist_props}`)
        if (!layout_playlists_entities) {
            console.warn(`Failed to fetch layout-playlists for layout: ${layout_eid}`)
            continue
        }
        console.debug("Layout playlists:", layout_playlists_entities)
        let filled_layout_playlists = layout_playlists_entities.entities.filter(lp => lp.playlist)
        console.debug("Filled layout playlists:", filled_layout_playlists)
        schedule.layout.layout_playlists = filled_layout_playlists
        console.debug("Layout-pl:", schedule.layout.layout_playlists)
        console.debug("Layout:", schedule.layout)
        if (schedule.layout.layout_playlists.length === 0) {
            console.debug(`No valid layout-playlists found for layout: ${layout_eid}`)
            continue
        }
        // Fetch the playlist in every layout-playlist
        for (const layout_playlist of schedule.layout.layout_playlists) {
            const playlist_eid = layout_playlist.playlist[0].reference
            const playlist_entity = await fetchJSON(`${ENTU_ENTITY_URL}/${playlist_eid}`)
            if (!playlist_entity) {
                console.warn(`Failed to fetch playlist: ${playlist_eid}`)
                continue
            }
            layout_playlist.playlist = playlist_entity.entity
            // Harvest playlist-medias referencing the playlist
            const playlist_media_props = '' // '&props=media.reference'
            const playlist_medias_entities = await fetchJSON(`${ENTU_ENTITY_URL}?_type.string=sw_playlist_media&_parent.reference=${playlist_eid}${playlist_media_props}`)
            if (!playlist_medias_entities) {
                console.warn(`Failed to fetch playlist-medias for playlist: ${playlist_eid}`)
                continue
            }
            layout_playlist.playlist.playlist_medias = playlist_medias_entities.entities
            if (layout_playlist.playlist.playlist_medias.length === 0) {
                console.debug(`No playlist-medias found for playlist: ${playlist_eid}`)
                continue
            }
            // Fetch the media in every playlist-media
            for (const playlist_media of layout_playlist.playlist.playlist_medias) {
                const media_eid = playlist_media.media[0].reference
                const media_entity = await fetchJSON(`${ENTU_ENTITY_URL}/${media_eid}`)
                if (!media_entity) {
                    console.warn(`Failed to fetch media: ${media_eid}`)
                    continue
                }
                playlist_media.media = media_entity.entity
            }
            layout_playlist.playlist.playlist_medias = layout_playlist.playlist.playlist_medias.filter(pm => pm.media && pm.media.length > 0)
        }
        schedule.layout.layout_playlists = schedule.layout.layout_playlists.filter(lp => lp.playlist)
    }
    // console.log("Configuration filled:", configuration, schedule_entities)
    configuration.schedules = configuration.schedules.filter(s => s.layout)
    if (configuration.schedules.length === 0) {
        console.warn(`No valid schedules found for configuration: ${configuration_eid}`, configuration)
        return false
    }
    console.debug("Configuration:", configuration)
    return configuration
}

// Flatten the configuration structure to comply with the format from swPublisher API
function flattenConfiguration(configuration) {
    if (!configuration || !configuration.schedules) {
        console.warn('Invalid configuration structure:', configuration)
        return null
    }

    try {
        configuration.schedules.forEach(schedule => {
            if (!schedule || !schedule.layout || !schedule.layout.layout_playlists) {
                console.warn('Invalid schedule structure:', schedule)
                return
            }

            // rename id's
            schedule.eid = schedule._id
            delete schedule._id
            schedule.layout.layoutEid = schedule.layout._id
            delete schedule.layout._id
            
            // camelCase
            schedule.layout.layoutPlaylists = schedule.layout.layout_playlists
            delete schedule.layout.layout_playlists

            // bring all properties from layout to schedule
            Object.assign(schedule, schedule.layout)
            delete schedule.layout

            schedule.layoutPlaylists.forEach(layoutPlaylist => {
                if (!layoutPlaylist || !layoutPlaylist.playlist) {
                    console.warn('Invalid layout playlist:', layoutPlaylist)
                    return
                }

                // rename id's
                layoutPlaylist.eid = layoutPlaylist._id
                delete layoutPlaylist._id
                layoutPlaylist.playlist.playlistEid = layoutPlaylist.playlist._id
                delete layoutPlaylist.playlist._id

                // camelCase
                layoutPlaylist.playlist.playlistMedias = layoutPlaylist.playlist.playlist_medias
                delete layoutPlaylist.playlist.playlist_medias

                // bring all properties from playlist to layoutPlaylist
                Object.assign(layoutPlaylist, layoutPlaylist.playlist)
                delete layoutPlaylist.playlist

                if (Array.isArray(layoutPlaylist.playlist_medias)) {
                    layoutPlaylist.playlist_medias.forEach(playlistMedia => {
                        if (!playlistMedia || !playlistMedia.media) {
                            console.warn('Invalid playlist media:', playlistMedia)
                            return
                        }

                        // rename id's
                        playlistMedia.eid = playlistMedia._id
                        playlistMedia.playlistMediaEid = playlistMedia._id // for some reason, this is the naming in API
                        delete playlistMedia._id
                        playlistMedia.media.mediaEid = playlistMedia.media._id
                        delete playlistMedia.media._id

                        // camelCase
                        playlistMedia.media.mediaType = playlistMedia.media.type
                        delete playlistMedia.media.type

                        // bring all properties from media to playlistMedia
                        Object.assign(playlistMedia, playlistMedia.media)
                        delete playlistMedia.media
                    })
                }
            })
        })
        return configuration
    } catch (error) {
        console.error('Error flattening configuration:', error)
        return null
    }
}

async function fetchConfigurations() {
    const url = `${ENTU_ENTITY_URL}?_type.string=sw_configuration&props=name.string,_parent.reference,_parent.string`
    try {
        const response = await fetch(url)
        const data = await response.json()
        console.debug("Configurations pre-fill:", data.entities)
        const fullConfigurations = await Promise.all(
            data.entities.map(config => fillConfiguration(config._id))
        )
        // console.log("Full configurations:", fullConfigurations)

        const flattenedConfigurations = fullConfigurations
            .filter(config => config)
            .map(flattenConfiguration)

        const validConfigurations = flattenedConfigurations
            .filter(validateConfiguration)
        if (validConfigurations.length === 0) {
            throw new Error("All configurations are invalid")
        }
        return validConfigurations
    } catch (error) {
        console.error("Failed to fetch configurations:", error)
        return []
    }
}

async function fetchScreenGroups() {
    const url = `${ENTU_ENTITY_URL}?_type.string=sw_screen_group&props=name.string,configuration.reference,published.datetime`
    try {
        const response = await fetch(url)
        const data = await response.json()
        return data.entities
    } catch (error) {
        console.error("Failed to fetch screen groups:", error)
        return []
    }
}

async function fetchScreens() {
    const url = `${ENTU_ENTITY_URL}?_type.string=sw_screen&props=name.string,screen_group.reference,screen_group.string,published.string&limit=10000`
    try {
        const response = await fetch(url)
        const data = await response.json()
        return data.entities
            // Filter out screens, that are not related to any screen group
            .filter(screen => screen.screen_group && screen.screen_group.length > 0)
    } catch (error) {
        console.error("Failed to fetch screens:", error)
        return []
    }
}

/**
 * Groups screens under screen groups, screen groups under configurations,
 * and configurations under customers.
 */
async function groupEntities() {
    const configurations = await fetchConfigurations()
    const screen_groups = await fetchScreenGroups()
    const screens = await fetchScreens()
    const grouped_customers = {}

    for (const screen of screens) {
        const screen_id = screen._id
        const screen_group_id = screen.screen_group[0].reference
        const screen_group = screen_groups.find(sg => sg._id === screen_group_id)
        if (!screen_group) return
        const screen_group_name = screen_group.name[0].string
        const screen_group_published_at = screen_group.published[0].datetime

        const configuration_id = screen_group.configuration[0].reference
        const configuration = configurations.find(c => c._id === configuration_id)
        if (!configuration) return
        const configuration_name = configuration.name[0].string

        const customer_id = configuration._parent[0].reference
        const customer_name = configuration._parent[0].string

        // Group screens under screen groups, screen groups under configurations, and configurations under customers
        if (!grouped_customers[customer_id]) {
            grouped_customers[customer_id] = {
                customerName: customer_name,
                configurations: {}
            }
        }
        if (!grouped_customers[customer_id].configurations[configuration_id]) {
            grouped_customers[customer_id].configurations[configuration_id] = {
                configName: configuration_name,
                screenGroups: {}
            }
        }
        if (!grouped_customers[customer_id].configurations[configuration_id].screenGroups[screen_group_id]) {
            grouped_customers[customer_id].configurations[configuration_id].screenGroups[screen_group_id] = {
                screenGroupName: screen_group_name,
                published: screen_group_published_at,
                screens: []
            }
        }

        grouped_customers[customer_id].configurations[configuration_id].screenGroups[screen_group_id].screens.push(screen)
    }

    return grouped_customers
}

// Scroll through the grouped data and enrich the screen groups with published date
async function fetchPublishedScreenGroups(groupedCustomers) {
    for (const customerId in groupedCustomers) {
        for (const configId in groupedCustomers[customerId].configurations) {
            for (const screenGroupId in groupedCustomers[customerId].configurations[configId].screenGroups) {
                const screenGroup = groupedCustomers[customerId].configurations[configId].screenGroups[screenGroupId]
                // Files at swpublisher are named after screen IDs
                const publisher_id = screenGroup.screens[0]._id
                const screenGroupData = await fetchFromPublisher(publisher_id)
                if (screenGroupData) {
                    screenGroup.configuration = screenGroupData
                    console.log("Screen group data:", screenGroupData)
                }
            }
        }
    }
}

/**
 * Fetches configurations, screen groups, and screens.
 * Builds the structure from bottom up, grouping screens under screen groups,
 * screen groups under configurations, and configurations under customers.
 */
async function displayConfigurations() {
    const groupedCustomers = await groupEntities()
    
    await fetchPublishedScreenGroups(groupedCustomers)
    console.log("Grouped customers:", groupedCustomers)

    const accordion = document.getElementById("accordion")
    for (const customerId in groupedCustomers) {
        const customerSection = document.createElement("section")
        customerSection.className = "customer-section"

        const customerTitle = document.createElement("button")
        customerTitle.className = "accordion"
        customerTitle.textContent = `${groupedCustomers[customerId].customerName} (${Object.keys(groupedCustomers[customerId].configurations).length})`
        customerSection.appendChild(customerTitle)

        const configList = document.createElement("div")
        configList.className = "panel"

        for (const configId in groupedCustomers[customerId].configurations) {
            const configSection = document.createElement("section")
            configSection.className = "config-section"

            const configTitle = document.createElement("button")
            configTitle.className = "accordion"
            configTitle.innerHTML = `
                ${groupedCustomers[customerId].configurations[configId].configName} 
                (${Object.keys(groupedCustomers[customerId].configurations[configId].screenGroups).length}) 
                ${toolbarSnippet(configId)}
            `
            configSection.appendChild(configTitle)

            const screenGroupList = document.createElement("div")
            screenGroupList.className = "panel"

            for (const screenGroupId in groupedCustomers[customerId].configurations[configId].screenGroups) {
                const screenGroupSection = document.createElement("section")
                screenGroupSection.className = "screen-group-section"

                const screenGroupTitle = document.createElement("button")
                screenGroupTitle.className = "accordion"
                const screenGroup = groupedCustomers[customerId].configurations[configId].screenGroups[screenGroupId]
                // console.log("Screen group:", screenGroup)
                screenGroupTitle.innerHTML = `
                    ${screenGroup.screenGroupName} 
                    (${screenGroup.screens.length}) 
                    ${toolbarSnippet(screenGroupId, screenGroup.published)}
                `
                screenGroupSection.appendChild(screenGroupTitle)

                // Add miniature screenwerk player
                const playerElement = document.createElement("div")
                playerElement.className = "mini-player"
                const playerPanel = document.createElement("div")
                playerPanel.className = "panel"
                playerPanel.appendChild(playerElement)
                screenGroupSection.appendChild(playerPanel)
                const configuration = screenGroup.configuration
                // console.log('Creating player with configuration:', configuration)
                if (configuration) {
                    const player = new EntuScreenWerkPlayer(playerElement, configuration)
                    player.play()
                } else {
                    console.error('No configuration available for screen group:', screenGroupId)
                    playerPanel.innerHTML = '<div class="error">Configuration not available</div>'
                }

                const screenList = document.createElement("div")
                screenList.className = "panel"

                screenGroup.screens.forEach(screen => {
                    const screenSection = document.createElement("section")
                    screenSection.className = "screen-section"
                    screenSection.innerHTML = `
                        ${screen.name[0].string} 
                        ${toolbarSnippet(screen._id, '', screen._id)}
                    `
                    screenList.appendChild(screenSection)
                })

                screenGroupSection.appendChild(screenList)
                screenGroupList.appendChild(screenGroupSection)
            }

            configSection.appendChild(screenGroupList)
            configList.appendChild(configSection)
        }

        customerSection.appendChild(configList)
        accordion.appendChild(customerSection)
    }

    // Add accordion functionality
    const accordions = document.getElementsByClassName("accordion")
    for (let i = 0; i < accordions.length; i++) {
        accordions[i].addEventListener("click", function() {
            this.classList.toggle("active")
            let panel = this.nextElementSibling
            while (panel && panel.classList.contains("panel")) {
            if (panel.style.display === "block") {
                panel.style.display = "none"
            } else {
                panel.style.display = "block"
            }
            panel = panel.nextElementSibling
            }
        })
    }
}

window.onload = displayConfigurations
